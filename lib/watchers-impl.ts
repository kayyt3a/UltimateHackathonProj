import type { WatcherBundle } from "./types";
import { checkAllWatchers as fixtureCheckAllWatchers } from "./fixtures/watchers";

/**
 * ===========================================================================
 * INTEGRATION POINT — Person B replaces the body of this file.
 * ===========================================================================
 *
 * Right now it delegates to the hardcoded fixture. When Person B's watchers
 * land, change the two lines below to:
 *
 *     export { checkAllWatchers } from "<their module>";
 *     export const USING_FIXTURE = false;
 *
 * Nothing else in the codebase needs to change — `lib/watchers.ts` and the
 * /api/diagnose route both go through here.
 *
 * Required signature:
 *     checkAllWatchers(timestamp: string): Promise<WatcherBundle> | WatcherBundle
 */

export async function checkAllWatchers(timestamp: string): Promise<WatcherBundle> {
  return fixtureCheckAllWatchers(timestamp);
}

/** Flips to false when the line above points at Person B's real watchers. */
export const USING_FIXTURE = true;
