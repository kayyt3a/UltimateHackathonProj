import { describe, expect, it } from "vitest";
import { estimateCostUsd, ratesFor } from "@/lib/cost";
import { VOICE_MODEL } from "@/lib/voice";

/**
 * lib/cost.ts — the demo's cost readout.
 *
 * Safety property protected here: the readout must never UNDERSTATE what was
 * spent, and must never read $0.00 when tokens were actually burned. Every
 * assertion injects `now`, so nothing here depends on the wall clock.
 */

const INTRO = Date.parse("2026-08-01T00:00:00Z");
const LAST_INTRO_MS = Date.parse("2026-08-31T23:59:59.999Z");
const FIRST_LIST_MS = Date.parse("2026-09-01T00:00:00Z");

const INTRO_RATES = { inputPerMTok: 2.0, outputPerMTok: 10.0 };
const LIST_RATES = { inputPerMTok: 3.0, outputPerMTok: 15.0 };

describe("ratesFor — the introductory-pricing boundary", () => {
  it("is introductory up to the last millisecond of 2026-08-31", () => {
    expect(ratesFor("claude-sonnet-5", LAST_INTRO_MS)).toEqual(INTRO_RATES);
  });

  it("flips to list pricing exactly at 2026-09-01T00:00:00Z, not before", () => {
    expect(ratesFor("claude-sonnet-5", FIRST_LIST_MS - 1)).toEqual(INTRO_RATES);
    expect(ratesFor("claude-sonnet-5", FIRST_LIST_MS)).toEqual(LIST_RATES);
    expect(ratesFor("claude-sonnet-5", FIRST_LIST_MS + 1)).toEqual(LIST_RATES);
  });

  it("prices a dated sonnet-5 snapshot id the same as the alias", () => {
    expect(ratesFor("claude-sonnet-5-20260514", INTRO)).toEqual(INTRO_RATES);
    expect(ratesFor(VOICE_MODEL, INTRO)).toEqual(INTRO_RATES);
  });

  it("prices the other known families", () => {
    expect(ratesFor("claude-opus-5", INTRO)).toEqual({ inputPerMTok: 5.0, outputPerMTok: 25.0 });
    expect(ratesFor("claude-opus-4-1", INTRO)).toEqual({ inputPerMTok: 5.0, outputPerMTok: 25.0 });
    expect(ratesFor("claude-haiku-4-5", INTRO)).toEqual({ inputPerMTok: 1.0, outputPerMTok: 5.0 });
  });
});

describe("ratesFor — unknown models fail EXPENSIVE, never free", () => {
  it("prices anything unrecognised at sonnet-5 list rates", () => {
    for (const model of [
      "",
      "   ",
      "some-future-model",
      "claude",
      "Claude-Sonnet-5", // case matters: startsWith is case-sensitive
      "openrouter/claude-sonnet-5", // contains but does not start with
      "gpt-9",
      "🐉-model",
      "sonnet-5",
    ]) {
      expect(ratesFor(model, INTRO), JSON.stringify(model)).toEqual(LIST_RATES);
    }
  });

  it("never returns a rate of zero for any model, known or not", () => {
    for (const model of ["", "claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5", "???"]) {
      const r = ratesFor(model, INTRO);
      expect(r.inputPerMTok, model).toBeGreaterThan(0);
      expect(r.outputPerMTok, model).toBeGreaterThan(0);
    }
  });

  it("an unknown model is never cheaper than the model we actually call", () => {
    const unknown = ratesFor("mystery-model", INTRO);
    const sonnet = ratesFor("claude-sonnet-5", INTRO);
    expect(unknown.inputPerMTok).toBeGreaterThanOrEqual(sonnet.inputPerMTok);
    expect(unknown.outputPerMTok).toBeGreaterThanOrEqual(sonnet.outputPerMTok);
  });
});

describe("estimateCostUsd — the readout must stay truthful", () => {
  it("is exactly the linear formula at introductory rates", () => {
    expect(estimateCostUsd("claude-sonnet-5", 3000, 400, INTRO)).toBeCloseTo(
      (3000 / 1e6) * 2 + (400 / 1e6) * 10,
      9,
    );
  });

  it("costs more after the introductory window closes, for identical usage", () => {
    const before = estimateCostUsd("claude-sonnet-5", 3000, 400, LAST_INTRO_MS);
    const after = estimateCostUsd("claude-sonnet-5", 3000, 400, FIRST_LIST_MS);
    expect(after).toBeGreaterThan(before);
  });

  it("reports zero only when zero tokens were used", () => {
    expect(estimateCostUsd("claude-sonnet-5", 0, 0, INTRO)).toBe(0);
    for (const model of ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5", "unknown"]) {
      expect(estimateCostUsd(model, 1, 0, INTRO), model).toBeGreaterThan(0);
      expect(estimateCostUsd(model, 0, 1, INTRO), model).toBeGreaterThan(0);
    }
  });

  it("is monotonic in both token counts — more tokens can never cost less", () => {
    let prev = -1;
    for (const n of [0, 1, 10, 100, 1_000, 10_000, 100_000]) {
      const usd = estimateCostUsd("claude-sonnet-5", n, n, INTRO);
      expect(usd).toBeGreaterThanOrEqual(prev);
      prev = usd;
    }
  });

  it("prices output tokens above input tokens for every model", () => {
    for (const model of ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5", "unknown"]) {
      expect(
        estimateCostUsd(model, 0, 100_000, INTRO),
        model,
      ).toBeGreaterThan(estimateCostUsd(model, 100_000, 0, INTRO));
    }
  });

  it("a corrective retry costs strictly more than one clean attempt", () => {
    // voice() sums tokens across both attempts precisely so this stays true.
    const once = estimateCostUsd("claude-sonnet-5", 3000, 400, INTRO);
    const twice = estimateCostUsd("claude-sonnet-5", 3000 + 3600, 400 + 380, INTRO);
    expect(twice).toBeGreaterThan(once);
  });

  it("keeps sub-cent precision without collapsing to zero", () => {
    const usd = estimateCostUsd("claude-sonnet-5", 850, 120, INTRO);
    expect(usd).toBeGreaterThan(0);
    expect(usd).toBeLessThan(0.01);
    // Rounded to microdollars, so it survives JSON without float noise.
    expect(Number((usd * 1e6).toFixed(6)) % 1).toBe(0);
  });

  it("is finite and deterministic for realistic and absurd token counts", () => {
    for (const [i, o] of [
      [0, 0],
      [1, 1],
      [8000, 8000],
      [10_000_000, 10_000_000],
      [Number.MAX_SAFE_INTEGER, 0],
    ] as const) {
      const a = estimateCostUsd("claude-sonnet-5", i, o, INTRO);
      const b = estimateCostUsd("claude-sonnet-5", i, o, INTRO);
      expect(Number.isFinite(a), `${i}/${o}`).toBe(true);
      expect(a).toBe(b);
    }
  });

  it("does not read the wall clock when `now` is supplied", () => {
    // Same inputs + same injected `now` must give the same answer regardless of
    // when the suite runs. (Guards the determinism constraint.)
    expect(estimateCostUsd("claude-sonnet-5", 1234, 567, INTRO)).toBe(
      estimateCostUsd("claude-sonnet-5", 1234, 567, INTRO),
    );
    expect(estimateCostUsd("claude-sonnet-5", 1234, 567, FIRST_LIST_MS)).not.toBe(
      estimateCostUsd("claude-sonnet-5", 1234, 567, INTRO),
    );
  });
});
