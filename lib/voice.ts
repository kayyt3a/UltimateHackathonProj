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
import { ESCALATION_RULE, TOTAL_EPISODES, waterEscalationPhrase } from "./analysis";

/** Used when a caveat has to be rewritten and nothing safe survives. */
const FALLBACK_CAVEAT = `Only ${TOTAL_EPISODES} past episodes exist, so this is a pattern, not a promise.`;

const DISAGREEMENT_WORD = /\b(\w*disput\w*|\w*disagree\w*|\w*contest\w*|\w*contradict\w*|\w*conflict\w*)\b/gi;
/** "undisputed", "indisputable" — the word negates itself with a prefix. */
const SELF_NEGATING_PREFIX = /^(un|in|ir|im|non)/i;
/** "no disagreement", "nobody disputes", "beyond dispute" — the opposite claim. */
const NEGATED_NEARBY =
  /\b(no|not|nothing|nobody|none|never|neither|nor|isn'?t|aren'?t|wasn'?t|without|beyond|hardly|barely)\b[\s\w']{0,24}$/i;

/**
 * Whether the reasoning actually acknowledges the disagreement.
 *
 * A bare /disput/i substring test is a false negative waiting to happen:
 * "the ledger is undisputed" contains it while asserting the exact opposite,
 * so the model could claim certainty and still pass the guardrail. Require at
 * least one occurrence that is not immediately negated.
 */
export function acknowledgesDisagreement(reasoning: string): boolean {
  DISAGREEMENT_WORD.lastIndex = 0;
  for (const match of reasoning.matchAll(DISAGREEMENT_WORD)) {
    const word = match[0];
    // "undisputed" / "indisputable" negate themselves.
    if (SELF_NEGATING_PREFIX.test(word)) continue;
    const preceding = reasoning.slice(Math.max(0, match.index - 28), match.index);
    if (NEGATED_NEARBY.test(preceding)) continue;
    return true;
  }
  return false;
}

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

/**
 * Sonnet 5 runs adaptive thinking by default, and `max_tokens` caps thinking
 * AND response text together — so a tight budget truncates the JSON mid-object
 * and the parse fails. The briefing itself is only a few hundred tokens; the
 * headroom is for thinking.
 */
export const VOICE_MAX_TOKENS = 8000;

/**
 * All the hard reasoning (severity, escalation permission, scope, which ledger
 * rows are disputed) is already done deterministically and handed to the model.
 * Its remaining job is prose, so low effort is the right trade for the one
 * expensive call that fires often.
 */
export const VOICE_EFFORT = "low" as const;

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
  /** Summed across every attempt this tick, including a corrective retry. */
  tokens_used: number;
  input_tokens: number;
  output_tokens: number;
  /** Guardrails that had to overrule the model. Empty is the happy path. */
  warnings: string[];
  model: string;
  attempts: number;
}

export interface HonestyAudit {
  diagnosis: Diagnosis;
  warnings: string[];
  /**
   * Violations code cannot silently repair — a fabricated probability in prose
   * a dragon actually reads. These trigger a corrective retry, then redaction.
   * Everything else (scope, escalation, nullability) is corrected in place and
   * reported as a warning only.
   */
  hardViolations: string[];
}

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

async function callModel(messages: Anthropic.MessageParam[]) {
  const response = await client().messages.create({
    model: VOICE_MODEL,
    max_tokens: VOICE_MAX_TOKENS,
    system: VOICE_SYSTEM_PROMPT,
    thinking: { type: "adaptive" },
    output_config: {
      effort: VOICE_EFFORT,
      format: { type: "json_schema", schema: DIAGNOSIS_SCHEMA },
    },
    messages,
  });

  if (response.stop_reason === "max_tokens") {
    // Say what actually happened rather than surfacing a JSON parse error.
    throw new Error(
      `Voice agent hit max_tokens (${VOICE_MAX_TOKENS}); the briefing was truncated mid-JSON. Raise VOICE_MAX_TOKENS.`,
    );
  }
  if (response.stop_reason === "refusal") {
    throw new Error("Voice agent declined to produce a briefing (stop_reason: refusal).");
  }

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("Voice agent returned no text block");
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.text) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Voice agent returned unparseable JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { raw, response };
}

/**
 * Call the Voice agent. Callers must only invoke this when severity is amber or
 * red — `diagnose()` enforces that.
 *
 * If the first briefing breaks an honesty rule that cannot be corrected by code
 * alone (a fabricated probability in the prose a dragon actually reads), we give
 * the model one corrective turn rather than shipping it. If it breaks the rule
 * twice, the offending sentences are redacted. Tokens are summed across every
 * attempt so the cost readout stays truthful.
 */
export async function voice(
  bundle: WatcherBundle,
  ledger: LedgerEntry[],
): Promise<VoiceResult> {
  const prompt = buildVoicePrompt(bundle, ledger);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  let inputTokens = 0;
  let outputTokens = 0;
  let attempts = 0;

  let { raw, response } = await callModel(messages);
  attempts += 1;
  inputTokens += response.usage.input_tokens;
  outputTokens += response.usage.output_tokens;

  let audit = enforceHonesty(raw, bundle.watchers, ledger);

  if (audit.hardViolations.length > 0) {
    // One corrective turn. The model sees exactly which rule it broke.
    // Echo the assistant turn back as the full content array, not just the text
    // block: this model runs adaptive thinking, and a continuation that drops
    // the thinking blocks it returned can be rejected outright — which would
    // turn the one guardrail that stops a fabricated probability into a thrown
    // request.
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content:
        `That briefing broke a rule you must not break:\n` +
        audit.hardViolations.map((v) => `- ${v}`).join("\n") +
        `\n\nA frightened dragon reads this at 3am. State only the deterministic rule and the ` +
        `historical count (for example "${waterEscalationPhrase()}"). Never a percentage, a ` +
        `probability, or odds — only four episodes exist. Return the corrected JSON.`,
    });

    const retry = await callModel(messages);
    attempts += 1;
    inputTokens += retry.response.usage.input_tokens;
    outputTokens += retry.response.usage.output_tokens;

    const retryAudit = enforceHonesty(retry.raw, bundle.watchers, ledger);
    const firstViolations = audit.hardViolations;

    if (retryAudit.hardViolations.length === 0) {
      audit = {
        ...retryAudit,
        warnings: [
          ...retryAudit.warnings,
          `First briefing was rejected and regenerated: ${firstViolations.join(" ")}`,
        ],
      };
    } else {
      // Twice is enough. Redact rather than ship a fabricated number.
      audit = redactHardViolations(retryAudit);
      audit.warnings.unshift(
        `Voice agent stated a probability twice; offending sentences were redacted before display.`,
      );
    }
    response = retry.response;
  }

  return {
    diagnosis: audit.diagnosis,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    tokens_used: inputTokens + outputTokens,
    warnings: audit.warnings,
    model: response.model,
    attempts,
  };
}

/** Drop only the sentences that make a likelihood claim, keep the rest. */
function stripProbabilitySentences(field: string, value: string): string {
  return value
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => scanForProbabilityClaims(field, sentence).length === 0)
    .join(" ")
    .trim();
}

/** Sentence-level scrub of anything that survived two attempts. */
function redactHardViolations(audit: HonestyAudit): HonestyAudit {
  const diagnosis = { ...audit.diagnosis };
  const warnings = [...audit.warnings];

  for (const field of ["reasoning", "headline", "recommended_action", "speech_text"] as const) {
    const value = diagnosis[field];
    if (typeof value !== "string") continue;
    if (scanForProbabilityClaims(field, value).length === 0) continue;

    const kept = stripProbabilitySentences(field, value);

    if (kept) {
      diagnosis[field] = kept;
    } else if (field === "reasoning") {
      diagnosis.reasoning =
        "Cloudy's note matches what the sensors are showing now. Only four past episodes exist, so this is a pattern, not a promise.";
    } else if (field === "speech_text") {
      delete diagnosis.speech_text;
    } else {
      diagnosis[field] = "See the watcher evidence.";
    }
    warnings.push(`Redacted a probability claim from "${field}".`);
  }

  return { diagnosis, warnings, hardViolations: [] };
}

/**
 * Words that make a statement a claim about likelihood. These are banned
 * outright — four episodes cannot support any of them.
 */
const PROBABILITY_WORDS: Array<[RegExp, string]> = [
  [/\bprobabilit(y|ies)\b/i, "the word 'probability'"],
  [/\bodds\b/i, "the word 'odds'"],
  [/\blikelihood\b/i, "the word 'likelihood'"],
  [/\b(chance|chances)\s+(of|that|it|the|is|are|was|seems?)\b/i, "a stated chance"],
  [/\bprobabl[ye]\b/i, "the word 'probable/probably'"],
  [/\bmost likely\b/i, "a stated likelihood"],
  // "8 in 10 water faults" — a rate we do not have. "2 of 2" stays permitted.
  [/\b\d+\s+in\s+\d+\b/, "an invented rate"],
  // Spelled-out ratios evade the digit patterns entirely.
  [/\b(chances?|odds)\s+in\s+\w+/i, "an invented rate"],
  [/\b\w+[-\s]in[-\s]\w+\s+(shot|odds|chance)\b/i, "an invented rate"],
  [/\b\d{1,3}(\.\d+)?\s*(%|percent)\s+(chance|probability|likely|risk)\b/i, "a percentage chance"],
];

/** A bare number-percent — a *measurement* unless it sits beside a forecast. */
const PERCENT = /\b\d{1,3}(\.\d+)?\s*(%|percent\b)/i;

/**
 * Forecast language that turns a nearby percentage into a prediction.
 * "airflow is at 62% of nominal" is a reading; "62% likely to fail" is a lie.
 */
const FORECAST = /\b(likely|unlikely|risk|expect|predicts?|forecast|will fail|going to fail|by (dawn|morning|midnight))\b/i;

/**
 * Sentence-scoped so a legitimate reading ("airflow at 62% of nominal", which
 * is exactly what Person B's evidence says) is not mistaken for a forecast.
 * A false positive costs a wasted retry; a false negative reads a fabricated
 * number aloud to a frightened dragon. We tolerate the first, never the second.
 */
export function scanForProbabilityClaims(field: string, value: string): string[] {
  const hits: string[] = [];

  for (const sentence of value.split(/(?<=[.!?])\s+/)) {
    for (const [pattern, label] of PROBABILITY_WORDS) {
      if (pattern.test(sentence)) {
        hits.push(
          `Voice output field "${field}" contained ${label}; the sample of four episodes cannot support a probability.`,
        );
      }
    }
    if (PERCENT.test(sentence) && FORECAST.test(sentence)) {
      hits.push(
        `Voice output field "${field}" paired a percentage with a forecast; only the deterministic rule and historical count may be stated.`,
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
): HonestyAudit {
  const warnings: string[] = [];
  const hardViolations: string[] = [];
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

    // "How long do I have" is the number a frightened dragon acts on, so the
    // model does not get to pick it. There is no deterministic model of time-to-
    // failure — only the observed fact that both past water faults reached
    // failure within this window. We report that bound instead of a forecast.
    const measuredLeadTime = ESCALATION_RULE.leadTimeHours;
    if (diagnosis.hours_to_critical_estimate !== measuredLeadTime) {
      if (diagnosis.hours_to_critical_estimate !== null) {
        warnings.push(
          `Voice agent estimated ${diagnosis.hours_to_critical_estimate}h to critical; replaced with Person A's measured ${measuredLeadTime}h warning-to-failure lead time, the only figure the record supports.`,
        );
      }
      diagnosis.hours_to_critical_estimate = measuredLeadTime;
    }
    const speech =
      typeof raw.speech_text === "string" ? raw.speech_text.trim() : "";
    if (speech) {
      diagnosis.speech_text = speech;
    } else {
      warnings.push("Voice agent predicted escalation but returned no speech_text.");
    }
  }

  // No fabricated percentages, anywhere — `caveat` included. It is displayed
  // next to the reasoning, so a probability smuggled in there reaches the
  // dragon exactly like one in the reasoning would.
  for (const field of ["reasoning", "escalation_basis", "headline", "recommended_action", "speech_text", "caveat"] as const) {
    const value = diagnosis[field];
    if (typeof value !== "string") continue;

    const hits = scanForProbabilityClaims(field, value);
    if (hits.length === 0) continue;
    warnings.push(...hits);

    if (field === "escalation_basis") {
      // Structured field with one correct value — repair it in place.
      diagnosis.escalation_basis = ruling.permittedBasis;
      warnings.push(
        "escalation_basis replaced with the deterministic rule and historical count.",
      );
    } else if (field === "caveat") {
      // One formulaic sentence with a safe canonical wording, so it repairs in
      // place like escalation_basis rather than costing a corrective turn. The
      // prompt itself contains the word "probability", so treating this as a
      // hard violation would burn a retry on most honest caveats.
      diagnosis.caveat = stripProbabilitySentences(field, value) || FALLBACK_CAVEAT;
      warnings.push("caveat was rewritten to drop a likelihood claim.");
    } else {
      // Free prose a dragon reads. Code cannot rewrite this safely, so it is a
      // hard violation: the caller retries, then redacts. Never ships as-is.
      hardViolations.push(...hits);
    }
  }

  // A disputed ledger entry must be named, not glossed over.
  const disputed = disputedLedgerEntries(watchers, ledger);
  if (disputed.length > 0 && !acknowledgesDisagreement(diagnosis.reasoning)) {
    warnings.push(
      `${disputed.length} relevant ledger entr${disputed.length === 1 ? "y is" : "ies are"} disputed but the reasoning did not mention the disagreement.`,
    );
  }

  return { diagnosis, warnings, hardViolations };
}
