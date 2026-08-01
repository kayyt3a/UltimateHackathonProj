import Anthropic from "@anthropic-ai/sdk";
import type {
  Diagnosis,
  LedgerEntry,
  Severity,
  WatcherBundle,
  WatcherOutput,
} from "./types";
import {
  disputedLedgerEntries,
  rulePredictedEscalation,
  ruleScope,
} from "./escalation";

/**
 * PART 2 — the Voice agent.
 *
 * Runs ONLY when severity is amber or red. This is the one expensive call that
 * fires often, so it uses claude-sonnet-5 rather than an Opus-tier model.
 *
 * It receives all 4 watcher outputs, the listener_validation note, and the
 * CURRENT knowledge ledger — so it can reference recently reconciled
 * information, not just Cloudy's original five notes.
 */

export const VOICE_MODEL = "claude-sonnet-5";
export const VOICE_MAX_TOKENS = 2000;

export const VOICE_SYSTEM_PROMPT = `You are the night-watch assistant for Reid Library, a dragon shelter with
damaged automation. A frightened dragon reads your output at 3am and decides
whether to wake the elders.

You will receive computed diagnostics and the current knowledge ledger. Do
not calculate anything yourself; use the numbers exactly as given.

Never invent numbers. Never claim certainty about failure timing. Never state
a percentage or probability of escalation — only the deterministic rule and
the historical count (e.g. "2 of 2 past cases"), because the sample is too
small to support a real probability. Never predict a brand-new fault starting
— only whether an already-firing warning is likely to worsen.`;

/**
 * The JSON schema is the locked output contract. Structured outputs guarantee
 * the shape; the guardrails below guarantee the honesty.
 */
const DIAGNOSIS_SCHEMA = {
  type: "object",
  properties: {
    entry_cited: { type: "string" },
    subsystem_scope: { type: "string", enum: ["water", "ventilation"] },
    mode: { type: "string", enum: ["plumbing", "ventilation", "stable"] },
    headline: { type: "string", description: "under 8 words, plain language" },
    recommended_action: {
      type: "string",
      description: "one sentence, what to do right now",
    },
    reasoning: {
      type: "string",
      description:
        "2-3 sentences. Reference Cloudy's note in his voice. Use consequences a dragon feels (cold, no water), not statistics. If a relevant ledger entry is disputed, say so plainly.",
    },
    predicted_to_escalate: { type: "boolean" },
    // Nullable fields use anyOf rather than a type array: anyOf is in the
    // documented structured-output schema subset, type-arrays are not.
    escalation_basis: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "the deterministic rule and historical rate that justify this. null if not escalating.",
    },
    hours_to_critical_estimate: {
      anyOf: [{ type: "number" }, { type: "null" }],
    },
    speech_text: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "one short sentence for text-to-speech. Plainer and shorter than reasoning. null unless predicted_to_escalate is true.",
    },
    confidence: { type: "string", enum: ["low", "moderate", "high"] },
    caveat: { type: "string", description: "one sentence naming the limitation honestly" },
  },
  required: [
    "entry_cited",
    "subsystem_scope",
    "mode",
    "headline",
    "recommended_action",
    "reasoning",
    "predicted_to_escalate",
    "escalation_basis",
    "hours_to_critical_estimate",
    "speech_text",
    "confidence",
    "caveat",
  ],
  additionalProperties: false,
} as const;

export function buildVoicePrompt(
  bundle: WatcherBundle,
  ledger: LedgerEntry[],
): string {
  const ruling = rulePredictedEscalation(bundle.watchers);
  const scope = ruleScope(bundle.watchers);
  const disputed = disputedLedgerEntries(bundle.watchers, ledger);

  const diagnostics = {
    watchers: bundle.watchers,
    listener_validation: bundle.listener_validation,
  };

  return `DIAGNOSTICS
${JSON.stringify(diagnostics, null, 2)}

CURRENT KNOWLEDGE LEDGER (may include recently-reconciled new sources)
${JSON.stringify(ledger, null, 2)}

HISTORY
Two past water faults escalated to total failure within 24 hours. Two past
ventilation faults resolved on their own. Only four episodes exist, so
confidence is inherently limited and you must say so.

DETERMINISTIC RULINGS (computed in code — obey these, do not re-derive them)
- Scope: ${scope.reason} Set subsystem_scope="${scope.subsystem_scope}" and mode="${scope.mode}". Recommend action for that subsystem only, never a blanket shutdown of the shelter.
- Escalation: ${ruling.allowed ? "ALLOWED" : "NOT ALLOWED"}. ${ruling.reason}
${
  ruling.allowed
    ? `  You may set predicted_to_escalate=true. If you do, escalation_basis must state exactly this rule and count: "${ruling.permittedBasis}".`
    : `  You MUST set predicted_to_escalate=false, escalation_basis=null, hours_to_critical_estimate=null and speech_text=null.`
}
- Disputed knowledge: ${
    disputed.length > 0
      ? `${disputed.length} relevant ledger entr${disputed.length === 1 ? "y is" : "ies are"} DISPUTED (${disputed
          .map((d) => d.id ?? d.entry ?? d.claim ?? "unknown")
          .join(", ")}). You must name the disagreement plainly in your reasoning rather than pretending certainty.`
      : "no relevant ledger entry is disputed."
  }

Return JSON only, matching the required schema.`;
}

export interface VoiceResult {
  diagnosis: Diagnosis;
  tokens_used: number;
  input_tokens: number;
  output_tokens: number;
  /** Guardrails that had to overrule the model. Empty is the happy path. */
  warnings: string[];
  model: string;
}

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

/**
 * Call the Voice agent. Callers must only invoke this when severity is amber or
 * red — `diagnose()` enforces that.
 */
export async function voice(
  bundle: WatcherBundle,
  ledger: LedgerEntry[],
): Promise<VoiceResult> {
  const response = await client().messages.create({
    model: VOICE_MODEL,
    max_tokens: VOICE_MAX_TOKENS,
    system: VOICE_SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: DIAGNOSIS_SCHEMA },
    },
    messages: [{ role: "user", content: buildVoicePrompt(bundle, ledger) }],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("Voice agent returned no text block");
  }

  const raw = JSON.parse(text.text) as Record<string, unknown>;
  const { diagnosis, warnings } = enforceHonesty(raw, bundle.watchers, ledger);

  return {
    diagnosis,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    tokens_used: response.usage.input_tokens + response.usage.output_tokens,
    warnings,
    model: response.model,
  };
}

const PROBABILITY_PATTERNS: Array<[RegExp, string]> = [
  [/\b\d{1,3}\s?%/, "a percentage"],
  [/\b\d{1,3}(\.\d+)?\s*percent\b/i, "a percentage"],
  [/\bprobability\b/i, "the word 'probability'"],
  [/\bodds\b/i, "the word 'odds'"],
  [/\b(chance|likelihood)\s+(of|that|it)\b/i, "a stated chance"],
];

function scanForProbabilityClaims(field: string, value: string): string[] {
  const hits: string[] = [];
  for (const [pattern, label] of PROBABILITY_PATTERNS) {
    if (pattern.test(value)) {
      hits.push(
        `Voice output field "${field}" contained ${label}; the sample of four episodes cannot support a probability.`,
      );
    }
  }
  return hits;
}

/**
 * Deterministic post-validation. The model explains WHY; code decides what it
 * is permitted to claim. If the model breaks an honesty rule we overrule it
 * rather than shipping the claim, and we say so in `warnings`.
 */
export function enforceHonesty(
  raw: Record<string, unknown>,
  watchers: WatcherOutput[],
  ledger: LedgerEntry[],
): { diagnosis: Diagnosis; warnings: string[] } {
  const warnings: string[] = [];
  const ruling = rulePredictedEscalation(watchers);
  const scope = ruleScope(watchers);

  const diagnosis: Diagnosis = {
    entry_cited: String(raw.entry_cited ?? scope.entry_cited),
    subsystem_scope: scope.subsystem_scope,
    mode: scope.mode,
    headline: String(raw.headline ?? "").trim(),
    recommended_action: String(raw.recommended_action ?? "").trim(),
    reasoning: String(raw.reasoning ?? "").trim(),
    predicted_to_escalate: raw.predicted_to_escalate === true,
    escalation_basis:
      typeof raw.escalation_basis === "string" && raw.escalation_basis.trim()
        ? raw.escalation_basis.trim()
        : null,
    hours_to_critical_estimate:
      typeof raw.hours_to_critical_estimate === "number"
        ? raw.hours_to_critical_estimate
        : null,
    confidence:
      raw.confidence === "high" || raw.confidence === "moderate"
        ? raw.confidence
        : "low",
    caveat: String(raw.caveat ?? "").trim(),
  };

  // Scope is code's decision, not the model's — never a blanket shutdown.
  if (raw.subsystem_scope && raw.subsystem_scope !== scope.subsystem_scope) {
    warnings.push(
      `Voice agent scoped to "${raw.subsystem_scope}"; overruled to "${scope.subsystem_scope}" (${scope.reason})`,
    );
  }
  if (raw.mode && raw.mode !== scope.mode) {
    warnings.push(
      `Voice agent set mode "${raw.mode}"; overruled to "${scope.mode}".`,
    );
  }

  // THE onset-vs-escalation rule. Predicting a brand-new fault is impossible;
  // only an already-firing water warning may be predicted to worsen.
  if (diagnosis.predicted_to_escalate && !ruling.allowed) {
    warnings.push(
      `Voice agent predicted escalation but escalation is not permitted: ${ruling.reason} Forced predicted_to_escalate=false.`,
    );
    diagnosis.predicted_to_escalate = false;
  }

  if (!diagnosis.predicted_to_escalate) {
    if (diagnosis.escalation_basis !== null) {
      warnings.push(
        "Voice agent supplied an escalation_basis without predicting escalation; cleared to null.",
      );
      diagnosis.escalation_basis = null;
    }
    if (diagnosis.hours_to_critical_estimate !== null) {
      warnings.push(
        "Voice agent supplied hours_to_critical_estimate without predicting escalation; cleared to null.",
      );
      diagnosis.hours_to_critical_estimate = null;
    }
    // speech_text is only present when predicted_to_escalate is true.
    if (typeof raw.speech_text === "string" && raw.speech_text.trim()) {
      warnings.push(
        "Voice agent supplied speech_text without predicting escalation; dropped so nothing is spoken aloud.",
      );
    }
  } else {
    if (!diagnosis.escalation_basis) {
      diagnosis.escalation_basis = ruling.permittedBasis;
      warnings.push(
        "Voice agent predicted escalation without a basis; substituted the deterministic rule and historical count.",
      );
    }
    const speech =
      typeof raw.speech_text === "string" ? raw.speech_text.trim() : "";
    if (speech) {
      diagnosis.speech_text = speech;
    } else {
      warnings.push("Voice agent predicted escalation but returned no speech_text.");
    }
  }

  // No fabricated percentages, anywhere.
  for (const field of ["reasoning", "escalation_basis", "headline", "recommended_action", "speech_text"] as const) {
    const value = diagnosis[field];
    if (typeof value === "string") {
      const hits = scanForProbabilityClaims(field, value);
      if (hits.length > 0) {
        warnings.push(...hits);
        if (field === "escalation_basis" && ruling.permittedBasis) {
          diagnosis.escalation_basis = ruling.permittedBasis;
          warnings.push(
            "escalation_basis replaced with the deterministic rule and historical count.",
          );
        }
      }
    }
  }

  // A disputed ledger entry must be named, not glossed over.
  const disputed = disputedLedgerEntries(watchers, ledger);
  if (disputed.length > 0 && !/disput/i.test(diagnosis.reasoning)) {
    warnings.push(
      `${disputed.length} relevant ledger entr${disputed.length === 1 ? "y is" : "ies are"} disputed but the reasoning did not mention the disagreement.`,
    );
  }

  return { diagnosis, warnings };
}
