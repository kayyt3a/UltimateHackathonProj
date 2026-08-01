import type { Severity, WatcherOutput, WatcherStatus } from "./types";

/**
 * PART 1 — the deterministic severity aggregator. No LLM. Ever.
 *
 *   any watcher "firing"  -> "red"
 *   else any "watching"   -> "amber"
 *   else                  -> "green"
 *
 * Worst-of-4 across the four watchers.
 *
 * Entry 2's `listener_validation` is deliberately NOT a parameter of this
 * function. It is informational only and is rendered in its own UI panel — it
 * can never move the traffic light. Making it un-passable is the point: the
 * severity a dragon sees at 3am is computed from structured output by code, so
 * the model cannot hallucinate green during a real emergency. The model's job
 * is explaining WHY, never deciding HOW BAD.
 */
export function aggregate(watchers: WatcherOutput[]): Severity {
  let sawWatching = false;

  for (const watcher of watchers) {
    switch (watcher.status) {
      case "firing":
        // Worst case reached — no later watcher can lower this.
        return "red";
      case "watching":
        sawWatching = true;
        break;
      case "quiet":
        break;
      default:
        // An unrecognised status means Person B's contract drifted. Failing
        // green would be the one unsafe choice, so we fail upward to amber and
        // let `severityWarnings` surface it.
        sawWatching = true;
        break;
    }
  }

  return sawWatching ? "amber" : "green";
}

const KNOWN_STATUSES: readonly WatcherStatus[] = ["firing", "watching", "quiet"];

/**
 * Non-fatal contract problems worth showing rather than swallowing. Kept
 * separate from `aggregate` so severity stays a pure worst-of-4 fold.
 */
export function severityWarnings(watchers: WatcherOutput[]): string[] {
  const warnings: string[] = [];

  if (watchers.length === 0) {
    // Deliberately does not say "defaulted to green": `aggregate` folds an
    // empty list to green, but `diagnose` fails that case upward to amber.
    warnings.push("No watcher output received; there is nothing to aggregate.");
  }

  for (const watcher of watchers) {
    if (!KNOWN_STATUSES.includes(watcher.status)) {
      warnings.push(
        `${watcher.entry} reported unknown status "${watcher.status}"; treated as watching (amber) rather than quiet.`,
      );
    }
  }

  return warnings;
}

/** Every watcher currently at "firing". */
export function firingWatchers(watchers: WatcherOutput[]): WatcherOutput[] {
  return watchers.filter((w) => w.status === "firing");
}
