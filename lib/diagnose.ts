import { aggregate, severityWarnings } from "./aggregate";
import { readCache, writeCache } from "./cache";
import { estimateCostUsd } from "./cost";
import { readCurrentLedgerChecked } from "./ledger";
import type { DiagnoseResponse, LedgerEntry } from "./types";
import { getWatchersChecked } from "./watchers";
import { VOICE_MODEL, enforceHonesty, voice } from "./voice";
import type { Diagnosis, WatcherOutput } from "./types";

/**
 * Re-run the honesty guardrails over a diagnosis that came off disk.
 *
 * A cache file is just JSON on the filesystem: it can be stale, it can predate
 * a rule change, and it can be hand-edited. Serving it unchecked would let a
 * forbidden escalation — and the speech_text that gets read aloud with it —
 * bypass every guardrail precisely on the path the demo depends on. The rules
 * are cheap and deterministic, so we simply apply them again.
 */
export function revalidateCachedDiagnosis(
  diagnosis: Diagnosis | null,
  watchers: WatcherOutput[],
  ledger: LedgerEntry[],
): { diagnosis: Diagnosis | null; warnings: string[] } {
  if (!diagnosis) return { diagnosis: null, warnings: [] };

  const audit = enforceHonesty(
    diagnosis as unknown as Record<string, unknown>,
    watchers,
    ledger,
  );
  return {
    diagnosis: audit.diagnosis,
    warnings: audit.warnings.map((w) => `Cached briefing re-checked: ${w}`),
  };
}

/**
 * One tick of the diagnosis pipeline:
 *
 *   { watchers, listener_validation } = await checkAllWatchers(ts)
 *   severity  = aggregate(watchers)               // plain code, no LLM
 *   ledger    = readCurrentLedger()
 *   diagnosis = severity === "green" ? null : await voice(watchers, ledger)
 *   sum token usage across the Voice call, estimate cost
 *   write the full response to a local cache file keyed by timestamp
 *
 * Every failure mode degrades to something honest: severity comes from code and
 * stays trustworthy even when the model, the ledger, or the disk is unavailable.
 */
export async function diagnose(timestamp: string): Promise<DiagnoseResponse> {
  // If Person B's watcher layer throws, we have no severity at all — the one
  // case where the cached response is strictly better than anything we can say.
  let watchersResult;
  try {
    watchersResult = await getWatchersChecked(timestamp);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[diagnose] watcher layer threw for ${timestamp}:`, err);
    const cached = await readCache(timestamp);
    if (cached) {
      return {
        ...cached,
        served_from_cache: true,
        warnings: [
          ...(cached.warnings ?? []),
          `Watcher layer failed (${message}); entire response served from cache.`,
        ],
      };
    }
    throw new Error(`Watcher layer failed and no cached response exists: ${message}`);
  }

  const { bundle, problems } = watchersResult;
  const { watchers, listener_validation } = bundle;

  // `aggregate` is a pure worst-of-4 fold, so an empty watcher list folds to
  // green. That is the one green a dragon must never be shown: it means the
  // watcher layer was unreadable (a renamed key, a non-object reply), not that
  // the shelter is calm. Failing upward happens here, where the contract
  // problems are already in hand, so `aggregate` stays a pure fold.
  const unreadable = watchers.length === 0;
  const severity = unreadable ? "amber" : aggregate(watchers);

  // A ledger failure must not lose the traffic light.
  let ledger: LedgerEntry[] = [];
  const ledgerWarnings: string[] = [];
  try {
    const read = await readCurrentLedgerChecked();
    ledger = read.ledger;
    ledgerWarnings.push(...read.problems);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ledgerWarnings.push(`Knowledge ledger unavailable (${message}); ledger panel is empty this tick.`);
  }

  const baseWarnings = [...problems, ...severityWarnings(watchers), ...ledgerWarnings];

  const finish = async (response: DiagnoseResponse): Promise<DiagnoseResponse> => {
    await writeCache(timestamp, response);
    return response;
  };

  // Nothing readable to explain, so no Voice call — and no cache write either,
  // because overwriting a good pre-warmed briefing with a degraded one would
  // remove the escape hatch exactly when it is needed.
  if (unreadable) {
    return {
      severity,
      watchers,
      listener_validation,
      diagnosis: null,
      ledger_snapshot: ledger,
      tokens_used: 0,
      estimated_cost_usd: 0,
      warnings: [
        ...baseWarnings,
        "No watcher output could be read; severity failed upward to amber rather than reporting green.",
      ],
    };
  }

  // Green never pays for a Voice call — there is nothing to explain.
  if (severity === "green") {
    return finish({
      severity,
      watchers,
      listener_validation,
      diagnosis: null,
      ledger_snapshot: ledger,
      tokens_used: 0,
      estimated_cost_usd: 0,
      ...(baseWarnings.length > 0 ? { warnings: baseWarnings } : {}),
    });
  }

  try {
    const result = await voice({ watchers, listener_validation }, ledger);
    const warnings = [...baseWarnings, ...result.warnings];
    return finish({
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
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (err) {
    // The Voice call failed. Severity is still trustworthy — it came from code —
    // so serve the cached diagnosis if we have one, and never a fabricated one.
    console.error(`[diagnose] voice call failed for ${timestamp}:`, err);
    const cached = await readCache(timestamp);
    const message = err instanceof Error ? err.message : String(err);

    if (cached?.diagnosis) {
      // The cached briefing was written under whatever rules applied then, so
      // re-check it against the rules and the watchers that apply NOW.
      const rechecked = revalidateCachedDiagnosis(cached.diagnosis, watchers, ledger);
      return {
        ...cached,
        severity,
        watchers,
        listener_validation,
        diagnosis: rechecked.diagnosis,
        ledger_snapshot: ledger,
        served_from_cache: true,
        // This tick made no model call, so it cost nothing. Reporting the
        // cached tick's spend again would double-count it across the demo.
        tokens_used: 0,
        estimated_cost_usd: 0,
        warnings: [
          ...(cached.warnings ?? []),
          ...baseWarnings,
          ...rechecked.warnings,
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
        ...baseWarnings,
        `Live Voice call failed (${message}) and no cached diagnosis exists for ${timestamp}. Severity is still valid — it is computed by code, not the model.`,
      ],
    };
  }
}

export { VOICE_MODEL };
