import { getRecordAt } from "./data";
import type { WatcherBundle } from "./types";
import { checkAllWatchers } from "./watchers";
import { normaliseWatcherBundle } from "./contract";


/**
 * Thin wrapper over Person B's `checkAllWatchers(timestamp)`.
 *
 * Person B owns `lib/watchers.ts`; Person A owns `lib/data.ts` underneath it. Everything downstream (the route, the prewarm script, the
 * Voice agent) goes through `getWatchers` and is unaffected by the swap.
 *
 * Output is normalised at this boundary so a naming mismatch surfaces as a
 * reported problem instead of a silently healthy-looking shelter. See
 * `lib/contract.ts`.
 */
export interface WatcherFetch {
  bundle: WatcherBundle;
  problems: string[];
}

export async function getWatchersChecked(timestamp: string): Promise<WatcherFetch> {
  const raw = await checkAllWatchers(canonicalTimestamp(timestamp));
  const { bundle, problems } = normaliseWatcherBundle(raw);
  return { bundle, problems };
}

/** Convenience for callers that do not need the contract report. */
export async function getWatchers(timestamp: string): Promise<WatcherBundle> {
  return (await getWatchersChecked(timestamp)).bundle;
}

/** True while running against the hardcoded fixture rather than Person B's code. */
export function isUsingFixture(): boolean {
  return false;
}

/**
 * Person B's watchers index records with an exact string compare, so
 * "2026-07-05T06:00:00.000Z" misses a record stored as "2026-07-05T06:00:00Z"
 * and throws. Resolve to the dataset's own spelling first.
 */
function canonicalTimestamp(timestamp: string): string {
  const target = new Date(timestamp).getTime();
  if (Number.isNaN(target)) return timestamp;
  const hit = getRecordAt(timestamp);
  return hit && new Date(hit.timestamp).getTime() === target ? hit.timestamp : timestamp;
}
