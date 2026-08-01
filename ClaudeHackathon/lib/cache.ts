import { promises as fs } from "node:fs";
import path from "node:path";
import type { DiagnoseResponse } from "./types";

/**
 * Local response cache, keyed by timestamp.
 *
 * The cache is not optional: Person D falls back to it if a live call stalls on
 * stage. Every successful tick writes; every failed tick reads.
 */

const CACHE_DIR =
  process.env.DIAGNOSE_CACHE_DIR ?? path.join(process.cwd(), ".cache", "diagnose");

/** `2026-07-05T04:00:00Z` -> `2026-07-05T04-00-00Z.json` (filesystem-safe). */
export function cacheKey(timestamp: string): string {
  return new Date(timestamp).toISOString().replace(/:/g, "-");
}

export function cachePath(timestamp: string): string {
  return path.join(CACHE_DIR, `${cacheKey(timestamp)}.json`);
}

/**
 * Writes atomically (temp file + rename) so a reader during the demo can never
 * observe a half-written JSON file, and returns false rather than throwing if
 * the filesystem is read-only. A cache write failing must never fail the
 * request that produced a perfectly good diagnosis.
 */
/**
 * `Date.now()` has millisecond resolution, so two writes for the same timestamp
 * in the same tick used to pick the same temp path: the first rename moved it,
 * the second hit ENOENT and reported the write as failed. A per-process counter
 * makes the name unique even under a burst of concurrent ticks.
 */
let tmpSequence = 0;

export async function writeCache(
  timestamp: string,
  response: DiagnoseResponse,
): Promise<boolean> {
  // cachePath throws on an unparseable timestamp, but this function promises to
  // return false rather than throw — scripts/prewarm.ts calls it directly.
  let file: string;
  try {
    file = cachePath(timestamp);
  } catch (err) {
    console.warn(`[cache] invalid timestamp ${timestamp}:`, err);
    return false;
  }
  // Never persist the cache-fallback marker — a cached tick is a fresh tick.
  const { served_from_cache: _ignored, ...payload } = response;
  const tmp = `${file}.${process.pid}.${Date.now()}.${(tmpSequence += 1)}.tmp`;

  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
    await fs.rename(tmp, file);
    return true;
  } catch (err) {
    console.warn(`[cache] could not write ${file}:`, err);
    await fs.rm(tmp, { force: true }).catch(() => {});
    return false;
  }
}

export async function readCache(
  timestamp: string,
): Promise<DiagnoseResponse | null> {
  try {
    const raw = await fs.readFile(cachePath(timestamp), "utf8");
    return JSON.parse(raw) as DiagnoseResponse;
  } catch {
    return null;
  }
}

export const DEMO_TIMESTAMPS = [
  // Every one of these is a real hour from Person A's prepared_data.json.
  "2026-07-04T23:00:00Z", // green  — one hour before the water episode begins
  "2026-07-05T04:00:00Z", // amber  — slope past -5 but not yet sustained 3h
  "2026-07-05T06:00:00Z", // red    — sustained; escalation ALLOWED, still only "warning"
  "2026-07-06T00:00:00Z", // red    — water has already failed (67.6 kPa)
  "2026-07-10T06:00:00Z", // red    — ventilation; escalation must be REFUSED
] as const;
