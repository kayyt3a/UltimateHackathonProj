import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURES } from "@/lib/fixtures/watchers";
import LEDGER from "@/data/knowledge_ledger.json";
import type { LedgerEntry } from "@/lib/types";

/**
 * lib/voice.ts — the retry / redaction path.
 *
 * THE ANTHROPIC CLIENT IS MOCKED. Nothing in this file touches the network and
 * no ANTHROPIC_API_KEY is required or read. The mock is registered with
 * `vi.hoisted` so the spy exists before `@/lib/voice` pulls the SDK in.
 */
const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create };
  },
}));

const { voice, VOICE_MAX_TOKENS, VOICE_MODEL, VOICE_SYSTEM_PROMPT, scanForProbabilityClaims } =
  await import("@/lib/voice");

const ledger = LEDGER as LedgerEntry[];

const CLEAN = {
  entry_cited: "Entry 1",
  subsystem_scope: "water",
  mode: "plumbing",
  headline: "Water pressure is falling fast",
  recommended_action: "Wake the elders and close the main valve now.",
  reasoning:
    "Cloudy wrote that when the pressure keeps sliding, the tanks run dry before morning. You will be thirsty and the pools will be cold.",
  predicted_to_escalate: true,
  escalation_basis:
    "pressure has been falling at 9.4 kPa/h; this pattern preceded total failure in 2 of 2 past water faults",
  hours_to_critical_estimate: 14,
  speech_text: "Water pressure is dropping fast. Wake the elders.",
  confidence: "moderate",
  caveat: "Only four episodes exist, so this is a pattern, not a promise.",
};

function reply(
  body: unknown,
  usage = { input_tokens: 100, output_tokens: 50 },
  overrides: Record<string, unknown> = {},
) {
  return {
    stop_reason: "end_turn",
    model: "claude-sonnet-5-20260514",
    usage,
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
    ...overrides,
  };
}

/** Every string a dragon could read or hear. */
function readableStrings(d: Record<string, unknown>): Array<[string, string]> {
  return (["headline", "recommended_action", "reasoning", "escalation_basis", "speech_text"] as const)
    .filter((f) => typeof d[f] === "string")
    .map((f) => [f, d[f] as string]);
}

beforeEach(() => {
  create.mockReset();
});

describe("voice() — happy path", () => {
  it("makes exactly one call, sums tokens, and reports no warnings", async () => {
    create.mockResolvedValueOnce(reply(CLEAN, { input_tokens: 1200, output_tokens: 340 }));

    const result = await voice(FIXTURES.WATER_FIRING, ledger);

    expect(create).toHaveBeenCalledOnce();
    expect(result.attempts).toBe(1);
    expect(result.input_tokens).toBe(1200);
    expect(result.output_tokens).toBe(340);
    expect(result.tokens_used).toBe(1540);
    expect(result.warnings).toEqual([]);
    expect(result.model).toBe("claude-sonnet-5-20260514");
    expect(result.diagnosis.speech_text).toBe(CLEAN.speech_text);
  });

  it("sends the locked model, budget, system prompt and schema — never a bare prompt", async () => {
    create.mockResolvedValueOnce(reply(CLEAN));
    await voice(FIXTURES.WATER_FIRING, ledger);

    const args = create.mock.calls[0][0];
    expect(args.model).toBe(VOICE_MODEL);
    expect(args.max_tokens).toBe(VOICE_MAX_TOKENS);
    expect(args.system).toBe(VOICE_SYSTEM_PROMPT);
    expect(args.output_config.format.type).toBe("json_schema");
    expect(args.messages).toHaveLength(1);
    expect(args.messages[0].role).toBe("user");
  });
});

describe("voice() — the corrective turn", () => {
  const dirty = {
    ...CLEAN,
    reasoning:
      "Cloudy's note matches the sensors exactly. There is an 87% chance the tanks run dry before dawn.",
  };

  it("retries once when prose carries a fabricated probability, and reports the override", async () => {
    create
      .mockResolvedValueOnce(reply(dirty, { input_tokens: 1200, output_tokens: 340 }))
      .mockResolvedValueOnce(reply(CLEAN, { input_tokens: 1800, output_tokens: 260 }));

    const result = await voice(FIXTURES.WATER_FIRING, ledger);

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    // Tokens summed across BOTH attempts so the cost readout stays truthful.
    expect(result.input_tokens).toBe(3000);
    expect(result.output_tokens).toBe(600);
    expect(result.tokens_used).toBe(3600);
    expect(result.warnings.join(" ")).toMatch(/First briefing was rejected and regenerated/);
    expect(result.diagnosis.reasoning).toBe(CLEAN.reasoning);
    expect(result.diagnosis.reasoning).not.toMatch(/87/);
  });

  it("the corrective turn replays the model's own words and names the rule it broke", async () => {
    // Include a thinking block: the assistant turn must be echoed back as the
    // FULL content array, because dropping thinking blocks from a continuation
    // would turn the guardrail into a thrown request.
    const withThinking = reply(dirty, undefined, {
      content: [
        { type: "thinking", thinking: "weighing the evidence", signature: "sig" },
        { type: "text", text: JSON.stringify(dirty) },
      ],
    });
    create.mockResolvedValueOnce(withThinking).mockResolvedValueOnce(reply(CLEAN));
    await voice(FIXTURES.WATER_FIRING, ledger);

    const messages = create.mock.calls[1][0].messages;
    expect(messages).toHaveLength(3);
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toEqual(withThinking.content);
    expect(JSON.stringify(messages[1].content)).toContain("87%");
    expect(messages[2].role).toBe("user");
    expect(messages[2].content).toMatch(/2 of 2 past water faults/);
    expect(messages[2].content).toMatch(/Never a percentage, a probability, or odds/);
    // The correction must never hand the model a fresh number to parrot.
    expect(messages[2].content).not.toMatch(/\b\d{1,3}\s*%/);
  });

  it("does NOT retry for a soft violation that code can repair in place", async () => {
    create.mockResolvedValueOnce(
      reply({ ...CLEAN, escalation_basis: "87% chance of total failure tonight" }),
    );
    const result = await voice(FIXTURES.WATER_FIRING, ledger);

    expect(create).toHaveBeenCalledOnce();
    expect(result.attempts).toBe(1);
    expect(result.diagnosis.escalation_basis).toMatch(/2 of 2 past water faults/);
    expect(result.diagnosis.escalation_basis).not.toMatch(/87/);
  });
});

describe("voice() — redaction when the model reoffends", () => {
  it("keeps the honest sentences and drops the fabricated one", async () => {
    const dirty = {
      ...CLEAN,
      reasoning:
        "Cloudy's note matches what the sensors show. There is an 87% chance of total failure by dawn.",
    };
    create.mockResolvedValue(reply(dirty, { input_tokens: 1000, output_tokens: 200 }));

    const result = await voice(FIXTURES.WATER_FIRING, ledger);

    expect(result.attempts).toBe(2);
    expect(result.tokens_used).toBe(2400);
    expect(result.diagnosis.reasoning).toBe("Cloudy's note matches what the sensors show.");
    expect(result.warnings[0]).toMatch(/stated a probability twice/);
    expect(result.warnings.join(" ")).toMatch(/Redacted a probability claim from "reasoning"/);
  });

  it("substitutes honest prose when EVERY sentence of the reasoning offends", async () => {
    create.mockResolvedValue(
      reply({
        ...CLEAN,
        reasoning: "There is an 87% chance of failure. The odds are against us.",
      }),
    );
    const result = await voice(FIXTURES.WATER_FIRING, ledger);

    expect(result.diagnosis.reasoning).toMatch(/pattern, not a promise/);
    expect(scanForProbabilityClaims("reasoning", result.diagnosis.reasoning)).toEqual([]);
  });

  it("REMOVES speech_text entirely rather than speaking a fabricated number aloud", async () => {
    create.mockResolvedValue(
      reply({
        ...CLEAN,
        speech_text: "There is a high probability the water fails tonight.",
      }),
    );
    const result = await voice(FIXTURES.WATER_FIRING, ledger);

    // Absent, not null — Person D only wires the TTS button when it is present.
    expect("speech_text" in result.diagnosis).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/Redacted a probability claim from "speech_text"/);
  });

  it("nothing a dragon can read or hear survives with a probability in it", async () => {
    create.mockResolvedValue(
      reply({
        ...CLEAN,
        headline: "70% likely to fail by dawn",
        recommended_action: "Act now; the odds are bad.",
        reasoning: "There is an 87% chance of total failure.",
        speech_text: "The likelihood of failure is high tonight.",
        escalation_basis: "roughly a 9 in 10 probability",
      }),
    );
    const result = await voice(FIXTURES.WATER_FIRING, ledger);

    for (const [field, value] of readableStrings(result.diagnosis as never)) {
      expect(scanForProbabilityClaims(field, value), `${field}: ${value}`).toEqual([]);
    }
    expect(JSON.stringify(result.diagnosis)).not.toMatch(/87%|9 in 10|likelihood|odds/i);
  });

  it("falls back to a neutral pointer when a short field is entirely offending", async () => {
    create.mockResolvedValue(
      reply({ ...CLEAN, headline: "70% likely to fail by dawn" }),
    );
    const result = await voice(FIXTURES.WATER_FIRING, ledger);
    expect(result.diagnosis.headline).toBe("See the watcher evidence.");
  });

  it("still sums tokens across both attempts when the second one is redacted", async () => {
    create
      .mockResolvedValueOnce(reply({ ...CLEAN, reasoning: "There is an 87% chance of failure." }, { input_tokens: 11, output_tokens: 3 }))
      .mockResolvedValueOnce(reply({ ...CLEAN, reasoning: "The odds are terrible." }, { input_tokens: 17, output_tokens: 5 }));
    const result = await voice(FIXTURES.WATER_FIRING, ledger);
    expect(result.tokens_used).toBe(36);
    expect(result.input_tokens).toBe(28);
    expect(result.output_tokens).toBe(8);
  });
});

describe("voice() — the guardrails still apply to whatever the model returns", () => {
  it("refuses an escalation the model invents on a ventilation fault, without a retry", async () => {
    create.mockResolvedValueOnce(
      reply({
        ...CLEAN,
        entry_cited: "Entry 3",
        subsystem_scope: "ventilation",
        mode: "ventilation",
        reasoning: "The maintenance log disputes the bearing theory, so this is uncertain.",
      }),
    );
    const result = await voice(FIXTURES.VENT_FIRING, ledger);

    expect(create).toHaveBeenCalledOnce();
    expect(result.diagnosis.predicted_to_escalate).toBe(false);
    expect(result.diagnosis.escalation_basis).toBeNull();
    expect(result.diagnosis.hours_to_critical_estimate).toBeNull();
    expect("speech_text" in result.diagnosis).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/escalation is not permitted/);
  });

  it("overrules a model that widens scope to the whole shelter", async () => {
    create.mockResolvedValueOnce(
      reply({ ...CLEAN, subsystem_scope: "everything", mode: "stable" }),
    );
    const result = await voice(FIXTURES.WATER_FIRING, ledger);
    expect(result.diagnosis.subsystem_scope).toBe("water");
    expect(result.diagnosis.mode).toBe("plumbing");
    expect(result.warnings.join(" ")).toMatch(/overruled to "water"/);
  });

  it("returns a usable diagnosis even when the model returns an empty object", async () => {
    create.mockResolvedValueOnce(reply({}));
    const result = await voice(FIXTURES.VENT_FIRING, ledger);

    expect(result.diagnosis.predicted_to_escalate).toBe(false);
    expect(result.diagnosis.confidence).toBe("low");
    expect(result.diagnosis.subsystem_scope).toBe("ventilation");
    expect(result.diagnosis.mode).toBe("ventilation");
    expect("speech_text" in result.diagnosis).toBe(false);
  });
});

describe("voice() — transport failures say what actually happened", () => {
  it("explains a truncated briefing instead of surfacing a JSON parse error", async () => {
    create.mockResolvedValue(reply(CLEAN, undefined, { stop_reason: "max_tokens" }));
    const err = await voice(FIXTURES.WATER_FIRING, ledger).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/max_tokens/);
    expect((err as Error).message).toMatch(/Raise VOICE_MAX_TOKENS/);
    expect((err as Error).message).toContain(String(VOICE_MAX_TOKENS));
  });

  it("reports a refusal plainly", async () => {
    create.mockResolvedValue(reply(CLEAN, undefined, { stop_reason: "refusal" }));
    await expect(voice(FIXTURES.WATER_FIRING, ledger)).rejects.toThrow(/declined to produce a briefing/);
  });

  it("reports a response with no text block", async () => {
    create.mockResolvedValue({
      stop_reason: "end_turn",
      model: "claude-sonnet-5",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "thinking", thinking: "..." }],
    });
    await expect(voice(FIXTURES.WATER_FIRING, ledger)).rejects.toThrow(/no text block/);
  });

  it("reports unparseable JSON", async () => {
    create.mockResolvedValue(reply("{ not json"));
    await expect(voice(FIXTURES.WATER_FIRING, ledger)).rejects.toThrow(/unparseable JSON/);
  });

  it("propagates a transport error rather than fabricating a briefing", async () => {
    create.mockRejectedValue(new Error("socket hang up"));
    await expect(voice(FIXTURES.WATER_FIRING, ledger)).rejects.toThrow(/socket hang up/);
  });

  it("propagates a failure on the CORRECTIVE turn instead of shipping the dirty first draft", async () => {
    create
      .mockResolvedValueOnce(reply({ ...CLEAN, reasoning: "There is an 87% chance of failure." }))
      .mockRejectedValueOnce(new Error("429 rate limited"));
    await expect(voice(FIXTURES.WATER_FIRING, ledger)).rejects.toThrow(/429/);
  });
});
