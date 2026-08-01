import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
// Type-only imports are erased, so they do not disturb the module-load
// ordering that `DIAGNOSE_CACHE_DIR` depends on.
import type { DiagnoseResponse, Diagnosis } from "@/lib/types";
import type { VoiceResult } from "@/lib/voice";

/**
 * lib/diagnose.ts — the fallback paths, with the Voice call MOCKED.
 *
 * Nothing here touches the network. `@/lib/voice` and `@/lib/watchers-impl` are
 * replaced, `DIAGNOSE_CACHE_DIR` points at a temp directory that is removed in
 * afterAll, and the clock is frozen so `estimated_cost_usd` is deterministic
 * across the sonnet-5 introductory-pricing boundary.
 */

const TMP = path.join(os.tmpdir(), `cloudy-diagnose-${process.pid}`);
const CACHE_DIR = path.join(TMP, "cache");
const PREV_CACHE_DIR = process.env.DIAGNOSE_CACHE_DIR;
process.env.DIAGNOSE_CACHE_DIR = CACHE_DIR;

const { voiceMock, watchersMock } = vi.hoisted(() => ({
  voiceMock: vi.fn(),
  watchersMock: vi.fn(),
}));

vi.mock("@/lib/voice", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  voice: voiceMock,
}));

vi.mock("@/lib/watchers-impl", () => ({
  checkAllWatchers: watchersMock,
  USING_FIXTURE: true,
}));

const { checkAllWatchers: fixtureWatchers } = await import("@/lib/fixtures/watchers");
const { diagnose } = await import("@/lib/diagnose");
const cache = await import("@/lib/cache");

const GREEN_TS = "2026-07-04T23:00:00Z";
const WATER_RED_TS = "2026-07-05T04:00:00Z";
const AMBER_TS = "2026-07-06T00:00:00Z";
const VENT_RED_TS = "2026-07-10T06:00:00Z";

/** Frozen inside the introductory-pricing window so cost never drifts. */
const FROZEN_NOW = new Date("2026-08-01T00:00:00Z");

const DIAGNOSIS: Diagnosis = {
  entry_cited: "Entry 1",
  subsystem_scope: "water",
  mode: "plumbing",
  headline: "Water pressure is falling fast",
  recommended_action: "Close the main valve.",
  reasoning: "Cloudy wrote about this exact slide.",
  predicted_to_escalate: true,
  escalation_basis: "…preceded total failure in 2 of 2 past water faults",
  hours_to_critical_estimate: 24,
  speech_text: "Water pressure is dropping fast. Wake the elders.",
  confidence: "moderate",
  caveat: "Only four episodes exist.",
};

const VOICE_OK: VoiceResult = {
  diagnosis: DIAGNOSIS,
  input_tokens: 3000,
  output_tokens: 400,
  tokens_used: 3400,
  warnings: ["Voice agent scoped to \"shelter\"; overruled to \"water\""],
  model: "claude-sonnet-5-20260514",
  attempts: 1,
};

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
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
  voiceMock.mockReset();
  watchersMock.mockReset();
  watchersMock.mockImplementation((ts: string) => fixtureWatchers(ts));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // Start every test from an empty cache so nothing leaks across cases.
  await fs.rm(CACHE_DIR, { recursive: true, force: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("diagnose — green never pays for a Voice call", () => {
  it("returns diagnosis: null, tokens 0, cost 0 and never calls the model", async () => {
    const res = await diagnose(GREEN_TS);
    expect(res.severity).toBe("green");
    expect(res.diagnosis).toBeNull();
    expect(res.tokens_used).toBe(0);
    expect(res.estimated_cost_usd).toBe(0);
    expect(voiceMock).not.toHaveBeenCalled();
  });

  it("still writes the green tick to the cache", async () => {
    await diagnose(GREEN_TS);
    const cached = await cache.readCache(GREEN_TS);
    expect(cached?.severity).toBe("green");
    expect(cached?.diagnosis).toBeNull();
  });
});

describe("diagnose — the happy amber/red path", () => {
  it("passes watchers and ledger to the Voice agent and returns its diagnosis", async () => {
    voiceMock.mockResolvedValue(VOICE_OK);
    const res = await diagnose(WATER_RED_TS);

    expect(res.severity).toBe("red");
    expect(res.diagnosis).toEqual(DIAGNOSIS);
    expect(res.tokens_used).toBe(3400);
    expect(res.warnings).toContain(VOICE_OK.warnings[0]);
    expect(res.ledger_snapshot.length).toBeGreaterThan(0);

    const [bundle, ledger] = voiceMock.mock.calls[0];
    expect(bundle.watchers).toHaveLength(4);
    expect(bundle.listener_validation.entry).toBe("Entry 2");
    expect(ledger.some((r: { id?: string }) => r.id === "L-003")).toBe(true);
  });

  it("prices the tick at sonnet-5 introductory rates (clock frozen)", async () => {
    voiceMock.mockResolvedValue(VOICE_OK);
    const res = await diagnose(WATER_RED_TS);
    expect(res.estimated_cost_usd).toBeCloseTo((3000 / 1e6) * 2 + (400 / 1e6) * 10, 9);
  });

  it("charges by the model the Voice agent actually reported, not the configured one", async () => {
    voiceMock.mockResolvedValue({ ...VOICE_OK, model: "claude-opus-5" });
    const res = await diagnose(WATER_RED_TS);
    expect(res.estimated_cost_usd).toBeCloseTo((3000 / 1e6) * 5 + (400 / 1e6) * 25, 9);
  });

  it("calls the Voice agent for amber too, not only red", async () => {
    voiceMock.mockResolvedValue(VOICE_OK);
    const res = await diagnose(AMBER_TS);
    expect(res.severity).toBe("amber");
    expect(voiceMock).toHaveBeenCalledOnce();
  });

  it("writes a cacheable copy that does NOT claim to be pre-cached", async () => {
    voiceMock.mockResolvedValue(VOICE_OK);
    await diagnose(WATER_RED_TS);
    const raw = JSON.parse(await fs.readFile(cache.cachePath(WATER_RED_TS), "utf8"));
    expect("served_from_cache" in raw).toBe(false);
    expect(raw.diagnosis.speech_text).toBe(DIAGNOSIS.speech_text);
  });
});

describe("diagnose — the Voice call fails", () => {
  it("keeps the code-computed severity and reports null rather than a fabricated diagnosis", async () => {
    voiceMock.mockRejectedValue(new Error("socket hang up"));
    const res = await diagnose(VENT_RED_TS);

    // THE point of the project: severity survives a model outage.
    expect(res.severity).toBe("red");
    expect(res.diagnosis).toBeNull();
    expect(res.tokens_used).toBe(0);
    expect(res.estimated_cost_usd).toBe(0);
    expect(res.served_from_cache).toBeUndefined();
    expect(res.warnings?.join(" ")).toMatch(/Live Voice call failed \(socket hang up\)/);
    expect(res.warnings?.join(" ")).toMatch(/Severity is still valid/);
  });

  it("serves the cached diagnosis when one exists, flagged as served_from_cache", async () => {
    voiceMock.mockResolvedValueOnce(VOICE_OK);
    await diagnose(WATER_RED_TS); // fill the cache

    voiceMock.mockRejectedValueOnce(new Error("503 overloaded"));
    const res = await diagnose(WATER_RED_TS);

    expect(res.served_from_cache).toBe(true);
    expect(res.diagnosis).toEqual(DIAGNOSIS);
    expect(res.severity).toBe("red");
    expect(res.warnings?.join(" ")).toMatch(/diagnosis served from cache/);
  });

  it("recomputes severity from live watchers even when the diagnosis comes from cache", async () => {
    // Cache a response that claims green, then force a Voice failure on a tick
    // whose watchers are firing. The traffic light must come from code.
    await cache.writeCache(VENT_RED_TS, {
      severity: "green",
      watchers: [],
      listener_validation: { entry: "Entry 2", accuracy_vs_system_status: 1, note: "" },
      diagnosis: DIAGNOSIS,
      ledger_snapshot: [],
      tokens_used: 999,
      estimated_cost_usd: 9.99,
    } as DiagnoseResponse);

    voiceMock.mockRejectedValue(new Error("down"));
    const res = await diagnose(VENT_RED_TS);

    expect(res.severity).toBe("red");
    expect(res.watchers).toHaveLength(4);
    expect(res.served_from_cache).toBe(true);
  });

  it("ignores a cached entry whose diagnosis is null and degrades honestly", async () => {
    await cache.writeCache(VENT_RED_TS, {
      severity: "amber",
      watchers: [],
      listener_validation: { entry: "Entry 2", accuracy_vs_system_status: 1, note: "" },
      diagnosis: null,
      ledger_snapshot: [],
      tokens_used: 0,
      estimated_cost_usd: 0,
    } as DiagnoseResponse);

    voiceMock.mockRejectedValue(new Error("down"));
    const res = await diagnose(VENT_RED_TS);

    expect(res.served_from_cache).toBeUndefined();
    expect(res.diagnosis).toBeNull();
    expect(res.severity).toBe("red");
  });

  /**
   * CHARACTERISATION — see report item (b).
   *
   * The cache-fallback path re-uses the cached `diagnosis` WITHOUT re-running
   * enforceHonesty against the current watchers, and spreads the cached
   * `tokens_used` / `estimated_cost_usd` into a tick that spent nothing. A
   * stale or hand-edited cache file therefore ships an escalation the current
   * rules forbid — including speech_text, which is read aloud.
   */
  it("currently serves a cached escalation on a tick where escalation is forbidden", async () => {
    await cache.writeCache(VENT_RED_TS, {
      severity: "red",
      watchers: [],
      listener_validation: { entry: "Entry 2", accuracy_vs_system_status: 1, note: "" },
      // Entry 3 is what fires at this timestamp — escalation is NOT permitted.
      diagnosis: { ...DIAGNOSIS, predicted_to_escalate: true },
      ledger_snapshot: [],
      tokens_used: 12345,
      estimated_cost_usd: 1.23,
    } as DiagnoseResponse);

    voiceMock.mockRejectedValue(new Error("down"));
    const res = await diagnose(VENT_RED_TS);

    expect(res.diagnosis?.predicted_to_escalate).toBe(true);
    expect(res.diagnosis?.speech_text).toBeDefined();
    expect(res.tokens_used).toBe(12345);
    expect(res.estimated_cost_usd).toBe(1.23);
  });
});

describe("diagnose — the watcher layer fails", () => {
  it("serves the entire cached response when the watcher layer throws", async () => {
    voiceMock.mockResolvedValueOnce(VOICE_OK);
    await diagnose(WATER_RED_TS);

    watchersMock.mockRejectedValueOnce(new Error("sensor bus offline"));
    const res = await diagnose(WATER_RED_TS);

    expect(res.served_from_cache).toBe(true);
    expect(res.severity).toBe("red");
    expect(res.warnings?.join(" ")).toMatch(/entire response served from cache/);
    expect(voiceMock).toHaveBeenCalledOnce(); // no second Voice call
  });

  it("throws (rather than inventing a severity) when there is no cache to fall back on", async () => {
    watchersMock.mockRejectedValue(new Error("sensor bus offline"));
    await expect(diagnose(WATER_RED_TS)).rejects.toThrow(/no cached response exists/);
  });
});

describe("diagnose — unreadable watcher output must never read green", () => {
  it.each([
    ["a non-object reply", 42],
    ["a null reply", null],
    ["a reply with no watchers key", { listener_validation: {} }],
    ["a reply whose watchers is not an array", { watchers: "four of them" }],
    ["an empty watchers array", { watchers: [], listener_validation: {} }],
    ["watchers full of junk", { watchers: [null, 7, "x"] }],
  ])("fails upward to amber for %s", async (_label, reply) => {
    watchersMock.mockResolvedValue(reply);
    const res = await diagnose(WATER_RED_TS);

    expect(res.severity).toBe("amber");
    expect(res.diagnosis).toBeNull();
    expect(res.tokens_used).toBe(0);
    expect(voiceMock).not.toHaveBeenCalled();
    expect(res.warnings?.join(" ")).toMatch(/failed upward to amber rather than reporting green/);
  });

  it("does not overwrite a good pre-warmed cache entry with the degraded response", async () => {
    voiceMock.mockResolvedValueOnce(VOICE_OK);
    await diagnose(WATER_RED_TS);
    const before = await cache.readCache(WATER_RED_TS);

    watchersMock.mockResolvedValue({ watchers: [] });
    await diagnose(WATER_RED_TS);

    expect(await cache.readCache(WATER_RED_TS)).toEqual(before);
  });
});

describe("diagnose — contract problems are surfaced, not swallowed", () => {
  it("reports a renamed entry label as a warning while still producing a diagnosis", async () => {
    watchersMock.mockResolvedValue({
      watchers: [
        {
          entry: "the water one",
          status: "firing",
          subsystem: "water",
          evidence: [{ hour: "h", signal: "pressure_slope_6h", value: -9.4, threshold: -5 }],
          reasoning: "",
        },
      ],
      listener_validation: { entry: "Entry 2", accuracy_vs_system_status: 1, note: "" },
    });
    voiceMock.mockResolvedValue({ ...VOICE_OK, warnings: [] });

    const res = await diagnose(WATER_RED_TS);
    expect(res.severity).toBe("red");
    expect(res.warnings?.join(" ")).toMatch(/unrecognised entry "the water one"/);
    expect(res.warnings?.join(" ")).toMatch(/Entry 3 is missing/);
  });

  it("is deterministic — the same timestamp twice yields the same response", async () => {
    voiceMock.mockResolvedValue(VOICE_OK);
    const a = await diagnose(AMBER_TS);
    const b = await diagnose(AMBER_TS);
    expect(a).toEqual(b);
  });
});
