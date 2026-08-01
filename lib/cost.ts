/**
 * Token cost estimation for the Voice call.
 *
 * claude-sonnet-5 list price is $3.00 / $15.00 per million tokens, with
 * introductory pricing of $2.00 / $10.00 running through 2026-08-31. We apply
 * the introductory rate while it is in effect so the demo's cost readout is not
 * overstated.
 */

const INTRO_ENDS = Date.parse("2026-09-01T00:00:00Z");

export interface Rates {
  inputPerMTok: number;
  outputPerMTok: number;
}

export function ratesFor(model: string, now: number = Date.now()): Rates {
  if (model.startsWith("claude-sonnet-5")) {
    return now < INTRO_ENDS
      ? { inputPerMTok: 2.0, outputPerMTok: 10.0 }
      : { inputPerMTok: 3.0, outputPerMTok: 15.0 };
  }
  if (model.startsWith("claude-opus-5") || model.startsWith("claude-opus-4")) {
    return { inputPerMTok: 5.0, outputPerMTok: 25.0 };
  }
  if (model.startsWith("claude-haiku-4-5")) {
    return { inputPerMTok: 1.0, outputPerMTok: 5.0 };
  }
  // Unknown model — price it as sonnet-5 list rather than reporting $0.
  return { inputPerMTok: 3.0, outputPerMTok: 15.0 };
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  now: number = Date.now(),
): number {
  const { inputPerMTok, outputPerMTok } = ratesFor(model, now);
  const usd =
    (inputTokens / 1_000_000) * inputPerMTok +
    (outputTokens / 1_000_000) * outputPerMTok;
  // Sub-cent precision matters here; a tick costs well under a penny.
  return Math.round(usd * 1e6) / 1e6;
}
