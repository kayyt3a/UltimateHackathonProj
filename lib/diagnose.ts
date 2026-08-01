import { aggregate, severityWarnings } from "./aggregate";
import { readCache, writeCache } from "./cache";
import { estimateCostUsd } from "./cost";
import { readCurrentLedger } from "./ledger";
import type { DiagnoseResponse } from "./types";
import { getWatchers } from "./watchers";
import { VOICE_MODEL, voice } from "./voice";

/**
 * One tick of the diagnosis pipeline:
 *
 *   { watchers, listener_validation } = await checkAllWatchers(ts)
 *   severity  = aggregate(watchers)               // plain code, no LLM
 *   ledger    = readCurrentLedger()
 *   diagnosis = severity === "green" ? null : await voice(watchers, ledger)
 *   sum token usage across the Voice call, estimate cost
 *   write the full response to a local cache file keyed by timestamp
 */
export async function diagnose(timestamp: string): Promise<DiagnoseResponse> {
  const { watchers, listener_validation } = await getWatchers(timestamp);
  const severity = aggregate(watchers);
  const ledger = await readCurrentLedger();

  const warnings = severityWarnings(watchers);

  // Green never pays for a Voice call — there is nothing to explain.
  if (severity === "green") {
    const response: DiagnoseResponse = {
      severity,
      watchers,
      listener_validation,
      diagnosis: null,
      ledger_snapshot: ledger,
      tokens_used: 0,
      estimated_cost_usd: 0,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
    await writeCache(timestamp, response);
    return response;
  }

  try {
    const result = await voice({ watchers, listener_validation }, ledger);
    const response: DiagnoseResponse = {
      severity,
      watchers,
      listener_validation,
      diagnosis: result.diagnosis,
      ledger_snapshot: ledger,
      tokens_used: result.tokens_used,
      estimated_cost_usd: estimateCostUsd(
        result.model,
        result.input_tokens,
        result.output_tokens,
      ),
      ...(warnings.concat(result.warnings).length > 0
        ? { warnings: warnings.concat(result.warnings) }
        : {}),
    };
    await writeCache(timestamp, response);
    return response;
  } catch (err) {
    // The Voice call failed. Severity is still trustworthy — it came from code —
    // so serve the cached diagnosis if we have one, and never a fabricated one.
    console.error(`[diagnose] voice call failed for ${timestamp}:`, err);
    const cached = await readCache(timestamp);
    const message = err instanceof Error ? err.message : String(err);

    if (cached) {
      return {
        ...cached,
        severity,
        watchers,
        listener_validation,
        ledger_snapshot: ledger,
        served_from_cache: true,
        warnings: [
          ...(cached.warnings ?? []),
          `Live Voice call failed (${message}); diagnosis served from cache.`,
        ],
      };
    }

    return {
      severity,
      watchers,
      listener_validation,
      diagnosis: null,
      ledger_snapshot: ledger,
      tokens_used: 0,
      estimated_cost_usd: 0,
      warnings: [
        ...warnings,
        `Live Voice call failed (${message}) and no cached diagnosis exists for ${timestamp}. Severity is still valid — it is computed by code, not the model.`,
      ],
    };
  }
}

export { VOICE_MODEL };
