import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DiagnoseResponse } from "@/lib/types";

/**
 * lib/cache.ts — atomic write, read failure, key normalisation.
 *
 * NOTE ON MODULE LOADING: cache.ts snapshots `DIAGNOSE_CACHE_DIR` at module
 * load time (`const CACHE_DIR = process.env.DIAGNOSE_CACHE_DIR ?? ...`), so the
 * env var MUST be set before the module is first imported. That is why this
 * file imports it dynamically rather than with a static `import`.
 */

const TMP_ROOT = path.join(os.tmpdir(), `cloudy-cache-${process.pid}`);
const CACHE_DIR = path.join(TMP_ROOT, "diagnose");
const PREV_DIR = process.env.DIAGNOSE_CACHE_DIR;
process.env.DIAGNOSE_CACHE_DIR = CACHE_DIR;

let cache: typeof import("@/lib/cache");

const RESPONSE: DiagnoseResponse = {
  severity: "red",
  watchers: [],
  listener_validation: { entry: "Entry 2", accuracy_vs_system_status: 1, note: "" },
  diagnosis: null,
  ledger_snapshot: [],
  tokens_used: 0,
  estimated_cost_usd: 0,
};

beforeAll(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });
  cache = await import("@/lib/cache");
});

afterAll(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
  if (PREV_DIR === undefined) delete process.env.DIAGNOSE_CACHE_DIR;
  else process.env.DIAGNOSE_CACHE_DIR = PREV_DIR;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cacheKey — normalisation", () => {
  it("collapses every equivalent spelling of one instant onto one key", () => {
    const canonical = cache.cacheKey("2026-07-05T04:00:00Z");
    for (const spelling of [
      "2026-07-05T04:00:00Z",
      "2026-07-05T04:00:00.000Z",
      "2026-07-05T04:00Z",
      "2026-07-05T04:00:00+00:00",
      "2026-07-05T06:00:00+02:00",
      "2026-07-04T21:00:00-07:00",
    ]) {
      expect(cache.cacheKey(spelling), spelling).toBe(canonical);
    }
  });

  it("never emits a character that could escape the cache directory", () => {
    for (const ts of ["2026-07-05T04:00:00Z", "2026-12-31T23:59:59.999Z", "1970-01-01T00:00:00Z"]) {
      const key = cache.cacheKey(ts);
      expect(key, ts).not.toMatch(/[:/\\]/);
      expect(key, ts).not.toContain("..");
    }
  });

  it("keeps distinct instants on distinct keys (no cache-collision across demo timestamps)", () => {
    const keys = cache.DEMO_TIMESTAMPS.map(cache.cacheKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("resolves inside the configured DIAGNOSE_CACHE_DIR", () => {
    const file = cache.cachePath("2026-07-05T04:00:00Z");
    expect(path.dirname(file)).toBe(CACHE_DIR);
    expect(file.endsWith(".json")).toBe(true);
  });

  it("cannot be steered out of the cache directory by a path-traversal timestamp", () => {
    // A traversal string is not a date, so cachePath throws rather than
    // producing a path outside CACHE_DIR. readCache swallows that; the point of
    // this test is that no file OUTSIDE the cache dir is ever addressed.
    for (const evil of ["../../etc/passwd", "..%2F..%2Fetc", "/etc/passwd", "2026-07-05T04:00:00Z/../../x"]) {
      expect(() => cache.cachePath(evil), evil).toThrow(RangeError);
    }
  });
});

describe("writeCache / readCache round trip", () => {
  it("writes and reads back a response verbatim", async () => {
    const ts = "2026-07-05T04:00:00Z";
    expect(await cache.writeCache(ts, RESPONSE)).toBe(true);
    expect(await cache.readCache(ts)).toEqual(RESPONSE);
  });

  it("reads back through a differently-spelled but equivalent timestamp", async () => {
    await cache.writeCache("2026-07-06T00:00:00Z", { ...RESPONSE, severity: "amber" });
    const viaOffset = await cache.readCache("2026-07-05T22:00:00-02:00");
    expect(viaOffset?.severity).toBe("amber");
  });

  it("never persists served_from_cache — a cached tick must not look pre-cached", async () => {
    const ts = "2026-07-10T06:00:00Z";
    await cache.writeCache(ts, { ...RESPONSE, served_from_cache: true });
    const back = await cache.readCache(ts);
    expect(back).not.toBeNull();
    expect("served_from_cache" in (back as object)).toBe(false);
  });

  it("leaves no .tmp files behind — the write is atomic (temp + rename)", async () => {
    await cache.writeCache("2026-07-04T23:00:00Z", RESPONSE);
    const entries = await fs.readdir(CACHE_DIR);
    expect(entries.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("a reader never observes a partially-written file", async () => {
    // 40 concurrent writers against one key; every read must yield complete,
    // parseable JSON, never a truncated object.
    const ts = "2026-07-11T00:00:00Z";
    const writes = Array.from({ length: 40 }, (_, i) =>
      cache.writeCache(ts, { ...RESPONSE, tokens_used: i }),
    );
    const reads = Array.from({ length: 40 }, () => cache.readCache(ts));
    const [written, read] = await Promise.all([Promise.all(writes), Promise.all(reads)]);
    expect(written.every(Boolean)).toBe(true);
    for (const r of read) {
      // null == "file not there yet", which is fine; a torn object is not.
      if (r !== null) expect(typeof r.tokens_used).toBe("number");
    }
    expect((await fs.readdir(CACHE_DIR)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("readCache — failure is always null, never a throw", () => {
  it("returns null for a timestamp that was never cached", async () => {
    expect(await cache.readCache("2030-01-01T00:00:00Z")).toBeNull();
  });

  it("returns null for an unparseable timestamp instead of throwing", async () => {
    for (const junk of ["", "not-a-date", "../../etc/passwd", "NaN", "undefined"]) {
      await expect(cache.readCache(junk), junk).resolves.toBeNull();
    }
  });

  it("returns null for a corrupt cache file rather than crashing the request", async () => {
    const ts = "2026-07-12T00:00:00Z";
    await fs.writeFile(cache.cachePath(ts), "{ this is not json", "utf8");
    expect(await cache.readCache(ts)).toBeNull();
  });

  it("returns null for a truncated (half-written) JSON body", async () => {
    const ts = "2026-07-13T00:00:00Z";
    const full = JSON.stringify(RESPONSE, null, 2);
    await fs.writeFile(cache.cachePath(ts), full.slice(0, Math.floor(full.length / 2)), "utf8");
    expect(await cache.readCache(ts)).toBeNull();
  });

  it("returns null for an empty cache file", async () => {
    const ts = "2026-07-14T00:00:00Z";
    await fs.writeFile(cache.cachePath(ts), "", "utf8");
    expect(await cache.readCache(ts)).toBeNull();
  });
});

describe("writeCache — a cache failure must never fail a good diagnosis", () => {
  it("returns false (does not throw) when the cache directory cannot be created", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const blocker = path.join(TMP_ROOT, "blocker-file");
    await fs.writeFile(blocker, "I am a file, not a directory", "utf8");

    process.env.DIAGNOSE_CACHE_DIR = path.join(blocker, "nested");
    vi.resetModules();
    try {
      const isolated = await import("@/lib/cache");
      await expect(isolated.writeCache("2026-07-05T04:00:00Z", RESPONSE)).resolves.toBe(false);
      expect(warn).toHaveBeenCalled();
    } finally {
      process.env.DIAGNOSE_CACHE_DIR = CACHE_DIR;
      vi.resetModules();
    }
  });

  /**
   * CHARACTERISATION — see report item (b).
   *
   * `cachePath(timestamp)` is called on line 34 of lib/cache.ts, OUTSIDE the
   * try/catch, so an unparseable timestamp makes writeCache REJECT rather than
   * return false. The docstring promises "returns false rather than throwing".
   * The /api/diagnose route validates `ts` first, so this is not reachable
   * through the HTTP contract today, but `diagnose()` is exported and called
   * directly by scripts/prewarm.ts.
   */
  it("currently REJECTS on an unparseable timestamp instead of returning false", async () => {
    await expect(cache.writeCache("not-a-timestamp", RESPONSE)).rejects.toThrow(RangeError);
  });
});

describe("DEMO_TIMESTAMPS", () => {
  it("are all valid, canonical, UTC instants", () => {
    expect(cache.DEMO_TIMESTAMPS).toHaveLength(4);
    for (const ts of cache.DEMO_TIMESTAMPS) {
      expect(Number.isNaN(Date.parse(ts)), ts).toBe(false);
      expect(ts, ts).toMatch(/Z$/);
    }
  });
});
