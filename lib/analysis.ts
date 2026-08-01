/**
 * ===========================================================================
 * PERSON A'S ANALYSIS — the empirical numbers the honesty rules rest on.
 * ===========================================================================
 *
 * Every claim the Voice agent is allowed to make traces back to a number in
 * this file. It is the single place to edit if the analysis is rerun.
 *
 * SOURCE: `prepared_data.json` -> `derived_constants`, and `verdicts.md`,
 * both on `main`. Values below are copied from that output, not estimated.
 */

/**
 * Onset detection: how many green->amber transitions (a brand-new fault
 * starting) the t+6h classifier caught. 0 of 24 — the 88.5% headline accuracy
 * is pure persistence. This is why the Voice agent may never predict a new
 * fault beginning. (verdicts.md, Figure 5.)
 */
export const ONSET = {
  caught: 0,
  total: 24,
  classifierAccuracy: 0.885,
} as const;

/**
 * The escalation rule, verbatim from `derived_constants.escalation`.
 * Person A's note: "Sample too small for a real probability — state as a count."
 */
export const ESCALATION_RULE = {
  signal: "pressure_slope_6h",
  thresholdKpaPerHour: -5.0,
  sustainedHours: 3,
  /** Measured warning-to-failure lead time. NOT a per-incident prediction. */
  leadTimeHours: 8,
} as const;

/** `derived_constants.ventilation_threshold` — residual below this is a fault. */
export const VENTILATION_RESIDUAL_THRESHOLD = -0.5005506506615708;

/**
 * The four recorded episodes, from `derived_constants.episodes`. Both water
 * episodes escalated to failure; neither ventilation episode did.
 */
export const EPISODES = {
  water: { reachedFailure: 2, total: 2, windowHours: 24 },
  ventilation: { selfResolved: 2, total: 2 },
} as const;

export const TOTAL_EPISODES = EPISODES.water.total + EPISODES.ventilation.total;

/**
 * Cloudy's five notes and what the data actually said about each. The ledger
 * panel and the Voice agent both lean on these verdicts, so a note that was
 * REFUTED can never be cited as though it were established.
 */
export const NOTE_VERDICTS = {
  "Entry 1": "supported",
  "Entry 2": "redundant",
  "Entry 3": "supported",
  "Entry 4": "refuted",
  "Entry 5": "unsupported",
} as const;

/** "0 of 24 onset transitions were caught" */
export const onsetPhrase = () => `${ONSET.caught} of ${ONSET.total} onset transitions were caught`;

/** "2 of 2 past water faults" */
export const waterEscalationPhrase = () =>
  `${EPISODES.water.reachedFailure} of ${EPISODES.water.total} past water faults`;
