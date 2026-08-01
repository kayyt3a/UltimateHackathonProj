import type { WatcherBundle } from "./types";
import { USING_FIXTURE, checkAllWatchers } from "./watchers-impl";
import { normaliseWatcherBundle } from "./contract";
import { canonicalTimestamp } from "./sensor-window";

/**
 * Thin wrapper over Person B's `checkAllWatchers(timestamp)`.
 *
 * The swap happens in `lib/watchers-impl.ts` — that file is the single
 * integration point. Everything downstream (the route, the prewarm script, the
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
  return USING_FIXTURE;
}
