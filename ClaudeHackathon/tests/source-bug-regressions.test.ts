/**
 * REGRESSION SUITE — three real source bugs found by the testing agent and
 * since fixed. Each one let the system look more certain than it was:
 *
 *   SB-1  a single null ledger row threw and took the whole Voice call down
 *   SB-2  "undisputed" / "indisputable" satisfied the disputed-knowledge
 *         guardrail while asserting the exact opposite
 *   SB-3  a ledger that failed to load was indistinguishable from a ledger
 *         with nothing disputed
 *
 * These must keep passing.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildVoicePrompt, enforceHonesty } from "@/lib/voice";
import { disputedLedgerEntries, isDisputed, relevantLedgerEntries } from "@/lib/escalation";
import { FIXTURES } from "@/lib/fixtures/watchers";
import type { LedgerEntry } from "@/lib/types";
import type { VoiceResult } from "@/lib/voice";

/**
 * ============================================================================
 * These assertions were written RED against the source as it stood, and each
 * one reproduced a live defect before it was fixed. Do not weaken an assertion
 * to make it pass — a failure here means the defect is back.
 *
 *   SB-1  lib/escalation.ts  relevantLedgerEntries / isDisputed dereferenced
 *                            every ledger row, so a single `null` row from
 *                            Person B's feed threw a TypeError out of
 *                            buildVoicePrompt and removed the diagnosis
 *                            entirely for a firing watcher.
 *   SB-2  lib/voice.ts       the "was the dispute named?" check was a bare
 *                            /disput/i substring test, which "undisputed" and
 *                            "indisputable" satisfy while asserting the exact
 *                            OPPOSITE of the ledger — on the one demo
 *                            timestamp (2026-07-10T06:00Z) that exists
 *                            specifically to catch a glossed-over dispute.
 *   SB-3  lib/ledger.ts +    readCurrentLedger swallowed its own errors and
 *         lib/diagnose.ts    returned [], so the try/catch in diagnose() was
 *                            unreachable and a ledger that FAILED TO LOAD was
 *                            indistinguishable from a ledger with nothing
 *                            disputed — the prompt asserted "no relevant
 *                            ledger entry is disputed" about knowledge that
 *                            was never read.
 * ============================================================================
 */

const TMP = path.join(os.tmpdir(), `cloudy-bugs-${process.pid}`);
const CACHE_DIR = path.join(TMP, "cache");
const PREV_CACHE_DIR = process.env.DIAGNOSE_CACHE_DIR;
const PREV_LEDGER_PATH = process.env.KNOWLEDGE_LEDGER_PATH;
process.env.DIAGNOSE_CACHE_DIR = CACHE_DIR;

const { voiceMock } = vi.hoisted(() => ({ voiceMock: vi.fn() }));
vi.mock("@/lib/voice", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  voice: voiceMock,
}));

const { diagnose } = await import("@/lib/diagnose");

const VENT_RED_TS = "2026-07-10T06:00:00Z";

const VOICE_OK = {
  diagnosis: {
    entry_cited: "Entry 3",
    subsystem_scope: "ventilation",
    mode: "ventilation",
    headline: "East vent is struggling",
    recommended_action: "Check the east vent grille.",
    reasoning: "Cloudy heard this rattle before.",
    predicted_to_escalate: false,
    escalation_basis: null,
    hours_to_critical_estimate: null,
    confidence: "low",
    caveat: "Only four episodes exist.",
  },
  input_tokens: 100,
  output_tokens: 20,
  tokens_used: 120,
  warnings: [],
  model: "claude-sonnet-5",
  attempts: 1,
} as unknown as VoiceResult;

beforeAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
  if (PREV_CACHE_DIR === undefined) delete process.env.DIAGNOSE_CACHE_DIR;
  else process.env.DIAGNOSE_CACHE_DIR = PREV_CACHE_DIR;
});

beforeEach(() => {
  voiceMock.mockReset();
  voiceMock.mockResolvedValue(VOICE_OK);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (PREV_LEDGER_PATH === undefined) delete process.env.KNOWLEDGE_LEDGER_PATH;
  else process.env.KNOWLEDGE_LEDGER_PATH = PREV_LEDGER_PATH;
});

describe("SB-1 — one malformed ledger row must not take down the Voice agent", () => {
  // lib/ledger.ts hands ANY array straight through as `LedgerEntry[]`, so a
  // null row from a sparse array or a failed serialisation is well within the
  // documented "pass whatever fields you like" contract.
  const withNullRow = [
    null,
    { id: "L-003", entry: "Entry 3", status: "disputed" },
    undefined,
  ] as unknown as LedgerEntry[];

  it("neither the ledger scan nor the prompt builder throws on a null row", () => {
    expect(() => isDisputed(null as unknown as LedgerEntry)).not.toThrow();
    expect(() =>
      relevantLedgerEntries(FIXTURES.VENT_FIRING.watchers, withNullRow),
    ).not.toThrow();
    expect(() => buildVoicePrompt(FIXTURES.VENT_FIRING, withNullRow)).not.toThrow();
  });

  it("the disputed row is still found when a null row sits in front of it", () => {
    const found = disputedLedgerEntries(FIXTURES.VENT_FIRING.watchers, withNullRow);
    expect(found.map((r) => r.id)).toEqual(["L-003"]);
  });
});

describe("SB-2 — 'undisputed' must not satisfy the disputed-knowledge guardrail", () => {
  // The safety property is "a disputed ledger entry must be NAMED, not glossed
  // over". Prose that asserts the OPPOSITE of the ledger must still be flagged.
  it("flags reasoning that asserts certainty using a word containing 'disput'", () => {
    const glosses = [
      "Cloudy heard the rattle and the bearing theory is indisputable.",
      "The maintenance log's loose-grille finding is undisputed, so the bearing is fine.",
      "This reading is beyond dispute.",
      "Nobody disputes that the fan bearing is seizing.",
    ];
    for (const reasoning of glosses) {
      const { warnings } = enforceHonesty(
        {
          entry_cited: "Entry 3",
          headline: "East vent is struggling",
          recommended_action: "Check the east vent grille.",
          reasoning,
          predicted_to_escalate: false,
          escalation_basis: null,
          hours_to_critical_estimate: null,
          confidence: "low",
          caveat: "Only four episodes exist.",
        },
        FIXTURES.VENT_FIRING.watchers,
        [{ id: "L-003", entry: "Entry 3", subsystem: "ventilation", status: "disputed" }],
      );
      expect(warnings.join(" "), reasoning).toMatch(/did not mention the disagreement/);
    }
  });
});

describe("SB-3 — a ledger that fails to load must not look like 'nothing disputed'", () => {
  // On the ventilation-firing tick the disputed row L-003 disappears when the
  // ledger cannot be read. Without a warning the dragon sees a confident
  // briefing and `ledger_snapshot: []`, which is indistinguishable from a
  // genuinely empty ledger.
  it("surfaces a warning when the configured ledger file cannot be read", async () => {
    process.env.KNOWLEDGE_LEDGER_PATH = path.join(TMP, "no-such-ledger.json");
    const res = await diagnose(VENT_RED_TS);

    expect(res.ledger_snapshot).toEqual([]);
    expect(res.warnings?.join(" ") ?? "").toMatch(/ledger/i);
  });

  it("surfaces a warning when the ledger file is corrupt", async () => {
    const bad = path.join(TMP, "corrupt-ledger.json");
    await fs.writeFile(bad, "{ not json", "utf8");
    process.env.KNOWLEDGE_LEDGER_PATH = bad;

    const res = await diagnose(VENT_RED_TS);
    expect(res.warnings?.join(" ") ?? "").toMatch(/ledger/i);
  });
});
