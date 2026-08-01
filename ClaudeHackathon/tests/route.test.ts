import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DiagnoseResponse } from "@/lib/types";

/**
 * app/api/diagnose/route.ts — the LOCKED contract Person D builds against.
 *
 * Exercised as a plain function against a `Request`; no server, no network.
 * `@/lib/diagnose` is mocked so the route's own behaviour (validation, the
 * cache=only escape hatch, error shaping) is what is under test.
 */

const TMP = path.join(os.tmpdir(), `cloudy-route-${process.pid}`);
const CACHE_DIR = path.join(TMP, "cache");
const PREV_CACHE_DIR = process.env.DIAGNOSE_CACHE_DIR;
process.env.DIAGNOSE_CACHE_DIR = CACHE_DIR;

const { diagnoseMock } = vi.hoisted(() => ({ diagnoseMock: vi.fn() }));

vi.mock("@/lib/diagnose", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/diagnose")>()),
  diagnose: diagnoseMock,
}));

const { GET } = await import("@/app/api/diagnose/route");
const cache = await import("@/lib/cache");

const TS = "2026-07-05T04:00:00Z";

const RESPONSE: DiagnoseResponse = {
  severity: "red",
  watchers: [
    { entry: "Entry 1", status: "firing", subsystem: "water", evidence: [], reasoning: "" },
  ],
  listener_validation: { entry: "Entry 2", accuracy_vs_system_status: 1, note: "n" },
  diagnosis: null,
  ledger_snapshot: [{ id: "L-001", status: "confirmed" }],
  tokens_used: 850,
  estimated_cost_usd: 0.003,
};

function req(query: string): Request {
  return new Request(`http://localhost:3000/api/diagnose${query}`);
}

beforeAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
  if (PREV_CACHE_DIR === undefined) delete process.env.DIAGNOSE_CACHE_DIR;
  else process.env.DIAGNOSE_CACHE_DIR = PREV_CACHE_DIR;
});

beforeEach(async () => {
  diagnoseMock.mockReset();
  diagnoseMock.mockResolvedValue(RESPONSE);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await fs.rm(CACHE_DIR, { recursive: true, force: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/diagnose — the locked contract", () => {
  it("returns the response verbatim with 200 and no-store", async () => {
    const res = await GET(req(`?ts=${TS}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(RESPONSE);
    expect(diagnoseMock).toHaveBeenCalledWith(TS);
  });

  it("carries every locked field through untouched", async () => {
    const body = (await (await GET(req(`?ts=${TS}`))).json()) as DiagnoseResponse;
    for (const key of [
      "severity",
      "watchers",
      "listener_validation",
      "diagnosis",
      "ledger_snapshot",
      "tokens_used",
      "estimated_cost_usd",
    ]) {
      expect(body, key).toHaveProperty(key);
    }
  });

  it("passes the exact ts string through — it does not re-normalise it", async () => {
    await GET(req("?ts=2026-07-05T04:00Z"));
    expect(diagnoseMock).toHaveBeenCalledWith("2026-07-05T04:00Z");
  });

  it("uses the first ts when the query repeats it", async () => {
    await GET(req(`?ts=${TS}&ts=2026-07-06T00:00:00Z`));
    expect(diagnoseMock).toHaveBeenCalledWith(TS);
  });

  it("defaults to a valid ISO instant when ts is absent", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    const [passed] = diagnoseMock.mock.calls[0];
    expect(Number.isNaN(Date.parse(passed))).toBe(false);
  });
});

describe("GET /api/diagnose — a malformed ts is a 400, never a fake diagnosis", () => {
  it.each([
    "",
    "yesterday",
    "not-a-date",
    "null",
    "undefined",
    "NaN",
    "%20",
    "../../etc/passwd",
    "2026-13-45T99:99:99Z",
    "%EF%BC%92%EF%BC%90%EF%BC%92%EF%BC%96", // fullwidth digits
    "🐉",
  ])("rejects ts=%j with 400", async (ts) => {
    const res = await GET(req(`?ts=${ts}`));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid ts parameter/);
    // A rejected request must never carry a traffic light of any colour.
    expect(body).not.toHaveProperty("severity");
    expect(diagnoseMock).not.toHaveBeenCalled();
  });

  /**
   * CHARACTERISATION — see report item (b).
   *
   * Validation is `Date.parse`, which is deliberately lenient: "0", "2026" and
   * "Jul 5 2026" are all accepted and forwarded to the pipeline as real
   * instants (2000-01-01, 2026-01-01, local-midnight 2026-07-05). A typo in the
   * demo URL therefore silently diagnoses a DIFFERENT hour rather than 400ing.
   */
  it("rejects loose, non-ISO date spellings instead of diagnosing another hour", async () => {
    // Date.parse alone accepts all of these: "0" becomes 2000-01-01 and
    // "2026-07-05" becomes midnight. A typo in the demo URL must 400, not
    // silently return a confident briefing about a completely different hour.
    for (const ts of ["0", "2026", "Jul 5 2026", "2026-07-05"]) {
      diagnoseMock.mockClear();
      const res = await GET(req(`?ts=${encodeURIComponent(ts)}`));
      expect(res.status, ts).toBe(400);
      expect(diagnoseMock, ts).not.toHaveBeenCalled();
    }
  });

  it("does not run the pipeline for a malformed ts even with cache=only", async () => {
    const res = await GET(req("?ts=nope&cache=only"));
    expect(res.status).toBe(400);
    expect(diagnoseMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/diagnose?cache=only — the on-stage escape hatch", () => {
  it("serves the pre-warmed file and never calls the pipeline", async () => {
    await cache.writeCache(TS, RESPONSE);
    const res = await GET(req(`?ts=${TS}&cache=only`));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    const { tokens_used: _t, estimated_cost_usd: _c, ...rest } = RESPONSE;
    expect(body).toMatchObject(rest);
    expect(body.served_from_cache).toBe(true);
    // Serving a file costs nothing; re-reporting the cached tick's spend would
    // double-count it every time the escape hatch is used on stage.
    expect(body.tokens_used).toBe(0);
    expect(body.estimated_cost_usd).toBe(0);
    expect(diagnoseMock).not.toHaveBeenCalled();
  });

  it("preserves a red severity from the cache rather than downgrading it", async () => {
    await cache.writeCache(TS, { ...RESPONSE, severity: "red" });
    const body = await (await GET(req(`?ts=${TS}&cache=only`))).json();
    expect(body.severity).toBe("red");
  });

  it("404s with an actionable hint when nothing is cached, and still makes no call", async () => {
    const res = await GET(req("?ts=2030-01-01T00:00:00Z&cache=only"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/npm run prewarm/);
    expect(diagnoseMock).not.toHaveBeenCalled();
  });

  it("404s rather than 500s when the cached file is corrupt", async () => {
    await fs.writeFile(cache.cachePath(TS), "{ truncated", "utf8");
    const res = await GET(req(`?ts=${TS}&cache=only`));
    expect(res.status).toBe(404);
  });

  it("only the exact value 'only' short-circuits — anything else is a live tick", async () => {
    await cache.writeCache(TS, RESPONSE);
    for (const value of ["ONLY", "Only", "true", "1", "yes", ""]) {
      diagnoseMock.mockClear();
      const res = await GET(req(`?ts=${TS}&cache=${value}`));
      expect(res.status, value).toBe(200);
      expect(diagnoseMock, value).toHaveBeenCalledOnce();
    }
  });
});

describe("GET /api/diagnose — unrecoverable failure", () => {
  it("returns 503 with a hint and no stack trace", async () => {
    diagnoseMock.mockRejectedValue(
      Object.assign(new Error("Watcher layer failed and no cached response exists: boom"), {
        stack: "Error: boom\n    at somewhere (/home/user/secret/path.ts:1:1)",
      }),
    );
    const res = await GET(req(`?ts=${TS}`));

    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.error).toMatch(/Could not produce a diagnosis/);
    expect(body.hint).toMatch(/npm run prewarm/);
    // No severity is better than a wrong one, and no internals leak.
    expect(body).not.toHaveProperty("severity");
    expect(JSON.stringify(body)).not.toMatch(/\n {4}at |secret\/path/);
  });

  it("handles a non-Error rejection without crashing", async () => {
    diagnoseMock.mockRejectedValue("just a string");
    const res = await GET(req(`?ts=${TS}`));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/just a string/);
  });

  it("does not fall back to the cache on a 503 — the caller must ask for it", async () => {
    await cache.writeCache(TS, RESPONSE);
    diagnoseMock.mockRejectedValue(new Error("boom"));
    const res = await GET(req(`?ts=${TS}`));
    expect(res.status).toBe(503);
  });
});
