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

export async function writeCache(
  timestamp: string,
  response: DiagnoseResponse,
): Promise<string> {
  const file = cachePath(timestamp);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Never persist the cache-fallback marker — a cached tick is a fresh tick.
  const { served_from_cache: _ignored, ...payload } = response;
  await fs.writeFile(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return file;
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
  "2026-07-04T23:00:00Z",
  "2026-07-05T04:00:00Z",
  "2026-07-06T00:00:00Z",
  "2026-07-10T06:00:00Z",
] as const;
