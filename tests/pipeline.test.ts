import { describe, expect, it } from "vitest";
import { aggregate } from "@/lib/aggregate";
import { getWatchers } from "@/lib/watchers";
import { cacheKey, DEMO_TIMESTAMPS } from "@/lib/cache";
import { estimateCostUsd, ratesFor } from "@/lib/cost";
import { readCurrentLedger } from "@/lib/ledger";

/**
 * Regression guard: a timestamp that misses the watcher lookup used to fall
 * through to all-quiet, which reads as GREEN. Severity silently reporting green
 * during a real fault is the exact failure this project exists to prevent, so
 * every demo timestamp is pinned to its expected severity here.
 */
describe("watcher lookup -> severity, per demo timestamp", () => {
  const expected: Record<string, string> = {
    "2026-07-04T23:00:00Z": "green",
    "2026-07-05T04:00:00Z": "amber",
    "2026-07-05T06:00:00Z": "red",
    "2026-07-06T00:00:00Z": "red",
    "2026-07-10T06:00:00Z": "red",
  };

  for (const ts of DEMO_TIMESTAMPS) {
    it(`${ts} -> ${expected[ts]}`, async () => {
      const { watchers } = await getWatchers(ts);
      expect(aggregate(watchers)).toBe(expected[ts]);
    });
  }

  it("is insensitive to equivalent timestamp spellings", async () => {
    for (const spelling of [
      "2026-07-05T06:00:00Z",
      "2026-07-05T06:00:00.000Z",
      "2026-07-05T06:00Z",
    ]) {
      const { watchers } = await getWatchers(spelling);
      expect(aggregate(watchers), spelling).toBe("red");
    }
  });

  it("returns four watchers plus Entry 2 validation for every timestamp", async () => {
    for (const ts of DEMO_TIMESTAMPS) {
      const bundle = await getWatchers(ts);
      expect(bundle.watchers).toHaveLength(4);
      expect(bundle.listener_validation.entry).toBe("Entry 2");
    }
  });
});

describe("cache keys", () => {
  it("are filesystem-safe and stable across equivalent spellings", () => {
    expect(cacheKey("2026-07-05T04:00:00Z")).not.toMatch(/:/);
    expect(cacheKey("2026-07-05T04:00Z")).toBe(cacheKey("2026-07-05T04:00:00.000Z"));
  });
});

describe("cost estimation", () => {
  it("uses sonnet-5 introductory pricing while it is in effect", () => {
    const intro = Date.parse("2026-08-01T00:00:00Z");
    expect(ratesFor("claude-sonnet-5", intro)).toEqual({
      inputPerMTok: 2.0,
      outputPerMTok: 10.0,
    });
  });

  it("reverts to list pricing after 2026-08-31", () => {
    const after = Date.parse("2026-09-15T00:00:00Z");
    expect(ratesFor("claude-sonnet-5", after)).toEqual({
      inputPerMTok: 3.0,
      outputPerMTok: 15.0,
    });
  });

  it("prices a typical tick in fractions of a cent", () => {
    const usd = estimateCostUsd("claude-sonnet-5", 3000, 400, Date.parse("2026-08-01T00:00:00Z"));
    expect(usd).toBeCloseTo(3000e-6 * 2 + 400e-6 * 10, 8);
    expect(usd).toBeLessThan(0.02);
  });

  it("never reports zero cost for an unknown model", () => {
    expect(estimateCostUsd("some-future-model", 1000, 1000)).toBeGreaterThan(0);
  });
});

describe("ledger", () => {
  it("loads the checked-in fixture and includes the disputed row", async () => {
    const ledger = await readCurrentLedger();
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger.some((r) => r.status === "disputed")).toBe(true);
  });
});
