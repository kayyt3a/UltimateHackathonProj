import type { WatcherBundle } from "./types";
import { USING_FIXTURE, checkAllWatchers } from "./watchers-impl";

/**
 * Thin wrapper over Person B's `checkAllWatchers(timestamp)`.
 *
 * The swap happens in `lib/watchers-impl.ts` — that file is the single
 * integration point. Everything downstream (the route, the prewarm script, the
 * Voice agent) goes through `getWatchers` and is unaffected by the swap.
 */
export async function getWatchers(timestamp: string): Promise<WatcherBundle> {
  return await checkAllWatchers(timestamp);
}

/** True while running against the hardcoded fixture rather than Person B's code. */
export function isUsingFixture(): boolean {
  return USING_FIXTURE;
}
