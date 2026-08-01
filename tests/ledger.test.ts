import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCurrentLedger } from "@/lib/ledger";
import { isDisputed, disputedLedgerEntries } from "@/lib/escalation";
import { FIXTURES } from "@/lib/fixtures/watchers";

/**
 * lib/ledger.ts — the shape-tolerance paths.
 *
 * Person B may hand us a bare array or any of four wrapper keys. Getting this
 * wrong is not cosmetic: an unread ledger looks EXACTLY like "nothing is
 * disputed", which lets the Voice agent claim certainty it has not earned.
 *
 * `readCurrentLedger` reads the env vars at CALL time (not module load), so
 * these tests can set them per-case. No network: `fetch` is always stubbed.
 */

const TMP = path.join(os.tmpdir(), `cloudy-ledger-${process.pid}`);
const PREV_PATH = process.env.KNOWLEDGE_LEDGER_PATH;
const PREV_URL = process.env.KNOWLEDGE_LEDGER_URL;

const ROWS = [
  { id: "L-100", entry: "Entry 3", subsystem: "ventilation", status: "disputed", claim: "x" },
  { id: "L-101", entry: "Entry 1", subsystem: "water", status: "confirmed", claim: "y" },
];

async function writeLedger(name: string, body: unknown): Promise<string> {
  const file = path.join(TMP, name);
  await fs.writeFile(file, typeof body === "string" ? body : JSON.stringify(body), "utf8");
  process.env.KNOWLEDGE_LEDGER_PATH = file;
  return file;
}

beforeAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
  await fs.mkdir(TMP, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (PREV_PATH === undefined) delete process.env.KNOWLEDGE_LEDGER_PATH;
  else process.env.KNOWLEDGE_LEDGER_PATH = PREV_PATH;
  if (PREV_URL === undefined) delete process.env.KNOWLEDGE_LEDGER_URL;
  else process.env.KNOWLEDGE_LEDGER_URL = PREV_URL;
});

describe("readCurrentLedger — wrapper-shape tolerance", () => {
  it("accepts a bare array", async () => {
    await writeLedger("bare.json", ROWS);
    expect(await readCurrentLedger()).toEqual(ROWS);
  });

  it.each(["entries", "ledger", "rows", "data"])("accepts { %s: [...] }", async (key) => {
    await writeLedger(`${key}.json`, { [key]: ROWS });
    expect(await readCurrentLedger()).toEqual(ROWS);
  });

  it("prefers the documented key order when several are present", async () => {
    await writeLedger("many.json", { data: [{ id: "D" }], rows: [{ id: "R" }], entries: [{ id: "E" }] });
    expect((await readCurrentLedger()).map((r) => r.id)).toEqual(["E"]);
  });

  it("passes unknown extra fields through VERBATIM so Person D can render them", async () => {
    const exotic = [
      {
        id: "L-999",
        entry: "Entry 3",
        claim: "c",
        status: "disputed",
        // Fields we never declared. All must survive into ledger_snapshot.
        provenance: { author: "Cloudy", 迷: "unicode key" },
        confidence_interval: [0.1, 0.9],
        emoji: "🐉",
        nested: { deep: { deeper: true } },
      },
    ];
    await writeLedger("exotic.json", exotic);
    expect(await readCurrentLedger()).toEqual(exotic);
  });
});

describe("readCurrentLedger — malformed input degrades to an empty ledger", () => {
  it.each([
    ["a JSON scalar", 42],
    ["a JSON string", '"just a string"'],
    ["null", null],
    ["an object with no known key", { items: ROWS }],
    ["a known key holding a non-array", { entries: { nope: true } }],
    ["a known key holding null", { entries: null, ledger: null }],
    ["an empty object", {}],
  ])("returns [] for %s", async (label, body) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeLedger(`${label.replace(/\W+/g, "_")}.json`, body);
    expect(await readCurrentLedger()).toEqual([]);
  });

  it("returns [] for unparseable JSON rather than throwing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeLedger("broken.json", "{ not json at all");
    await expect(readCurrentLedger()).resolves.toEqual([]);
  });

  it("returns [] when the configured file does not exist", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.KNOWLEDGE_LEDGER_PATH = path.join(TMP, "definitely-not-here.json");
    await expect(readCurrentLedger()).resolves.toEqual([]);
  });

  it("falls back to the checked-in fixture when no override is set", async () => {
    delete process.env.KNOWLEDGE_LEDGER_PATH;
    delete process.env.KNOWLEDGE_LEDGER_URL;
    const ledger = await readCurrentLedger();
    expect(ledger.some((r) => r.id === "L-003" && r.status === "disputed")).toBe(true);
  });
});

describe("readCurrentLedger — the live URL never becomes a hard dependency", () => {
  it("uses the live endpoint when it answers", async () => {
    process.env.KNOWLEDGE_LEDGER_URL = "https://example.invalid/ledger";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ entries: ROWS }), { status: 200 }),
    );
    expect(await readCurrentLedger()).toEqual(ROWS);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("falls back to the file when the endpoint answers non-2xx", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeLedger("fallback-500.json", ROWS);
    process.env.KNOWLEDGE_LEDGER_URL = "https://example.invalid/ledger";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 503 }));
    expect(await readCurrentLedger()).toEqual(ROWS);
  });

  it("falls back to the file when the endpoint is unreachable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeLedger("fallback-throw.json", ROWS);
    process.env.KNOWLEDGE_LEDGER_URL = "https://example.invalid/ledger";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await readCurrentLedger()).toEqual(ROWS);
  });

  it("falls back to the file when the endpoint returns 200 with unparseable JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeLedger("fallback-badjson.json", ROWS);
    process.env.KNOWLEDGE_LEDGER_URL = "https://example.invalid/ledger";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>oops</html>", { status: 200 }));
    // res.json() rejects inside the try, so we degrade to the file, not a crash.
    await expect(readCurrentLedger()).resolves.toEqual(ROWS);
  });
});

describe("isDisputed — tolerant in the SAFE direction only", () => {
  it("catches the dispute vocabulary across every accepted field", () => {
    for (const field of ["status", "state", "verification", "verdict", "confidence"]) {
      for (const word of ["disputed", "contested", "conflicting", "conflict", "contradicted", "unresolved"]) {
        expect(isDisputed({ [field]: word }), `${field}=${word}`).toBe(true);
        expect(isDisputed({ [field]: word.toUpperCase() }), `${field}=${word}`).toBe(true);
        expect(isDisputed({ [field]: `  ${word}  ` }), `${field}=${word} padded`).toBe(true);
      }
    }
    expect(isDisputed({ disputed: true })).toBe(true);
  });

  it("does NOT flag settled knowledge, and does not flag a negation as a dispute", () => {
    for (const row of [
      { status: "confirmed" },
      { status: "unverified" },
      { status: "not disputed" }, // anchored regex — correctly not a dispute
      { status: "undisputed" },
      { status: "" },
      { status: null },
      { status: 7 },
      { claim: "the maintenance log disputes the bearing theory" }, // prose, not a marker
      {},
    ]) {
      expect(isDisputed(row as never), JSON.stringify(row)).toBe(false);
    }
  });

  /**
   * CHARACTERISATION — see report item (b).
   *
   * lib/escalation.ts:201 checks `row.disputed === true` strictly, so a
   * teammate emitting the JSON string "true", or 1, is read as NOT disputed.
   * The file's own comment says erring toward "this is disputed" is the safe
   * direction, so these are tolerance gaps in the UNSAFE direction.
   */
  it("currently MISSES a stringly-typed dispute marker", () => {
    expect(isDisputed({ disputed: "true" } as never)).toBe(false);
    expect(isDisputed({ disputed: "yes" } as never)).toBe(false);
    expect(isDisputed({ disputed: 1 } as never)).toBe(false);
    expect(isDisputed({ status: "in dispute" } as never)).toBe(false);
    expect(isDisputed({ status: "disagreement" } as never)).toBe(false);
  });

  it("never throws on a hostile row shape", () => {
    for (const row of [
      { status: { toString: () => "disputed" } },
      { status: ["disputed"] },
      Object.create(null),
      { __proto__: { status: "disputed" } },
    ]) {
      expect(() => isDisputed(row as never)).not.toThrow();
    }
  });
});

describe("disputedLedgerEntries — relevance scoping", () => {
  it("matches on entry label OR subsystem of any non-quiet watcher", () => {
    const byEntry = disputedLedgerEntries(FIXTURES.VENT_FIRING.watchers, [
      { id: "by-entry", entry: "Entry 3", status: "disputed" },
    ]);
    expect(byEntry.map((r) => r.id)).toEqual(["by-entry"]);

    const bySubsystem = disputedLedgerEntries(FIXTURES.VENT_FIRING.watchers, [
      { id: "by-subsystem", subsystem: "ventilation", status: "disputed" },
    ]);
    expect(bySubsystem.map((r) => r.id)).toEqual(["by-subsystem"]);
  });

  it("ignores rows tied to quiet watchers only", () => {
    // Entry 4 is quiet in the ventilation-firing fixture.
    expect(
      disputedLedgerEntries(FIXTURES.VENT_FIRING.watchers, [
        { id: "quiet-row", entry: "Entry 4", status: "disputed" },
      ]),
    ).toEqual([]);
  });

  it("returns [] for an empty ledger — indistinguishable from 'nothing disputed'", () => {
    // This is exactly why a ledger LOAD FAILURE must be surfaced as a warning.
    // See tests/known-source-bugs.test.ts.
    expect(disputedLedgerEntries(FIXTURES.VENT_FIRING.watchers, [])).toEqual([]);
  });

  it("does not choke on rows missing every field it looks at", () => {
    expect(() =>
      disputedLedgerEntries(FIXTURES.VENT_FIRING.watchers, [{}, { id: "x" }, { entry: "" }]),
    ).not.toThrow();
  });
});
