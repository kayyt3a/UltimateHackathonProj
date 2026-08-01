/**
 * ===========================================================================
 * PERSON A'S ANALYSIS — the empirical numbers the honesty rules rest on.
 * ===========================================================================
 *
 * Every claim the Voice agent is allowed to make traces back to a number in
 * this file. It is the single place to edit if Person A's analysis is rerun on
 * more data — nothing else hardcodes these figures.
 */

/**
 * Onset detection: how many green->amber transitions (a brand-new fault
 * starting) the deterministic watchers caught. 0 of 24. This is why the Voice
 * agent may never predict a new fault beginning.
 */
export const ONSET = {
  caught: 0,
  total: 24,
} as const;

/**
 * Escalation history. Only four episodes exist in total, which is why we quote
 * counts and never a probability.
 */
export const EPISODES = {
  water: { reachedFailure: 2, total: 2, windowHours: 24 },
  ventilation: { selfResolved: 2, total: 2 },
} as const;

export const TOTAL_EPISODES = EPISODES.water.total + EPISODES.ventilation.total;

/** "0 of 24 onset transitions were caught" */
export const onsetPhrase = () => `${ONSET.caught} of ${ONSET.total} onset transitions were caught`;

/** "2 of 2 past water faults" */
export const waterEscalationPhrase = () =>
  `${EPISODES.water.reachedFailure} of ${EPISODES.water.total} past water faults`;
