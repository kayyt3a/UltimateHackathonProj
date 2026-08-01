import { describe, expect, it } from "vitest";
import {
  disputedLedgerEntries,
  rulePredictedEscalation,
  ruleScope,
} from "@/lib/escalation";
import { enforceHonesty, buildVoicePrompt } from "@/lib/voice";
import { FIXTURES } from "@/lib/fixtures/watchers";
import LEDGER from "@/data/knowledge_ledger.json";
import type { LedgerEntry } from "@/lib/types";

const ledger = LEDGER as LedgerEntry[];

const escalatingModelOutput = {
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
  hours_to_critical_estimate: 24,
  speech_text: "Water pressure is dropping fast. Wake the elders.",
  confidence: "moderate",
  caveat: "Only four episodes exist, so this is a pattern, not a promise.",
};

describe("escalation rule — onset vs escalation", () => {
  it("ALLOWS escalation when Entry 1 fires on water with the pressure-slope rule", () => {
    const ruling = rulePredictedEscalation(FIXTURES.WATER_FIRING.watchers);
    expect(ruling.allowed).toBe(true);
    expect(ruling.sourceEntry).toBe("Entry 1");
    expect(ruling.permittedBasis).toMatch(/2 of 2 past water faults/);
    expect(ruling.permittedBasis).toMatch(/9\.4 kPa\/h/);
  });

  it("FORBIDS escalation when only ventilation is firing", () => {
    const ruling = rulePredictedEscalation(FIXTURES.VENT_FIRING.watchers);
    expect(ruling.allowed).toBe(false);
    expect(ruling.reason).toMatch(/0 of 24 onset transitions/);
  });

  it("FORBIDS escalation when nothing is firing (green->amber onset)", () => {
    expect(rulePredictedEscalation(FIXTURES.VENT_WATCHING.watchers).allowed).toBe(false);
    expect(rulePredictedEscalation(FIXTURES.ALL_QUIET.watchers).allowed).toBe(false);
  });

  it("FORBIDS escalation when Entry 1 fires without the pressure-slope signal", () => {
    const watchers = structuredClone(FIXTURES.WATER_FIRING.watchers);
    watchers[0].evidence = [
      { hour: "2026-07-05T04:00:00Z", signal: "tank_level_pct", value: 12, threshold: 20 },
    ];
    const ruling = rulePredictedEscalation(watchers);
    expect(ruling.allowed).toBe(false);
    expect(ruling.reason).toMatch(/pressure-slope rule is not among its evidence/);
  });
});

describe("scope rule — never a blanket shutdown", () => {
  it("Entry 1 firing -> plumbing / water", () => {
    expect(ruleScope(FIXTURES.WATER_FIRING.watchers)).toMatchObject({
      subsystem_scope: "water",
      mode: "plumbing",
      entry_cited: "Entry 1",
    });
  });

  it("Entry 3 firing -> ventilation / ventilation", () => {
    expect(ruleScope(FIXTURES.VENT_FIRING.watchers)).toMatchObject({
      subsystem_scope: "ventilation",
      mode: "ventilation",
      entry_cited: "Entry 3",
    });
  });

  it("Entry 4 firing -> plumbing / water", () => {
    const watchers = structuredClone(FIXTURES.ALL_QUIET.watchers);
    watchers[2].status = "firing";
    expect(ruleScope(watchers)).toMatchObject({
      subsystem_scope: "water",
      mode: "plumbing",
      entry_cited: "Entry 4",
    });
  });

  it("water wins over ventilation when both fire — water is the one that escalates", () => {
    const watchers = structuredClone(FIXTURES.WATER_FIRING.watchers);
    watchers[1].status = "firing";
    expect(ruleScope(watchers).subsystem_scope).toBe("water");
  });

  it("falls back to a watching entry when nothing is firing", () => {
    expect(ruleScope(FIXTURES.VENT_WATCHING.watchers)).toMatchObject({
      subsystem_scope: "ventilation",
      mode: "ventilation",
    });
  });
});

describe("enforceHonesty — the model explains WHY, code decides what it may claim", () => {
  it("passes a compliant escalating briefing through untouched", () => {
    const { diagnosis, warnings } = enforceHonesty(
      { ...escalatingModelOutput },
      FIXTURES.WATER_FIRING.watchers,
      ledger,
    );
    expect(warnings).toEqual([]);
    expect(diagnosis.predicted_to_escalate).toBe(true);
    expect(diagnosis.speech_text).toBe("Water pressure is dropping fast. Wake the elders.");
    expect(diagnosis.hours_to_critical_estimate).toBe(24);
  });

  it("overrules a predicted escalation on a ventilation fault", () => {
    const { diagnosis, warnings } = enforceHonesty(
      { ...escalatingModelOutput, entry_cited: "Entry 3", subsystem_scope: "ventilation" },
      FIXTURES.VENT_FIRING.watchers,
      ledger,
    );
    expect(diagnosis.predicted_to_escalate).toBe(false);
    expect(diagnosis.escalation_basis).toBeNull();
    expect(diagnosis.hours_to_critical_estimate).toBeNull();
    expect(diagnosis.speech_text).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/escalation is not permitted/);
  });

  it("refuses to predict a brand-new fault starting when nothing is firing", () => {
    const { diagnosis, warnings } = enforceHonesty(
      { ...escalatingModelOutput },
      FIXTURES.VENT_WATCHING.watchers,
      ledger,
    );
    expect(diagnosis.predicted_to_escalate).toBe(false);
    expect(warnings.join(" ")).toMatch(/0 of 24 onset transitions/);
  });

  it("strips a fabricated percentage and restores the deterministic basis", () => {
    const { diagnosis, warnings } = enforceHonesty(
      { ...escalatingModelOutput, escalation_basis: "87% chance of total failure tonight" },
      FIXTURES.WATER_FIRING.watchers,
      ledger,
    );
    expect(diagnosis.escalation_basis).toMatch(/2 of 2 past water faults/);
    expect(diagnosis.escalation_basis).not.toMatch(/87%/);
    expect(warnings.join(" ")).toMatch(/percentage/);
  });

  it("flags a probability word smuggled into the reasoning", () => {
    const { warnings } = enforceHonesty(
      {
        ...escalatingModelOutput,
        reasoning: "There is a high probability the tanks run dry before dawn.",
      },
      FIXTURES.WATER_FIRING.watchers,
      ledger,
    );
    expect(warnings.join(" ")).toMatch(/probability/);
  });

  it("drops speech_text when escalation is not predicted, so nothing is spoken aloud", () => {
    const { diagnosis, warnings } = enforceHonesty(
      { ...escalatingModelOutput, predicted_to_escalate: false },
      FIXTURES.WATER_FIRING.watchers,
      ledger,
    );
    expect(diagnosis.speech_text).toBeUndefined();
    expect(diagnosis.escalation_basis).toBeNull();
    expect(warnings.join(" ")).toMatch(/dropped so nothing is spoken aloud/);
  });

  it("overrules a model that tries to widen scope to the whole shelter", () => {
    const { diagnosis, warnings } = enforceHonesty(
      { ...escalatingModelOutput, subsystem_scope: "ventilation", mode: "ventilation" },
      FIXTURES.WATER_FIRING.watchers,
      ledger,
    );
    expect(diagnosis.subsystem_scope).toBe("water");
    expect(diagnosis.mode).toBe("plumbing");
    expect(warnings.join(" ")).toMatch(/overruled/);
  });

  it("flags a briefing that ignores a disputed ledger entry", () => {
    const { warnings } = enforceHonesty(
      { ...escalatingModelOutput, entry_cited: "Entry 3", reasoning: "The bearing is seizing." },
      FIXTURES.VENT_FIRING.watchers,
      ledger,
    );
    expect(warnings.join(" ")).toMatch(/disputed but the reasoning did not mention/);
  });

  it("accepts a briefing that names the disagreement", () => {
    const { warnings } = enforceHonesty(
      {
        ...escalatingModelOutput,
        predicted_to_escalate: false,
        escalation_basis: null,
        hours_to_critical_estimate: null,
        speech_text: null,
        entry_cited: "Entry 3",
        subsystem_scope: "ventilation",
        mode: "ventilation",
        reasoning:
          "Cloudy heard the rattle and called it a seizing bearing, but the maintenance log disputes that — it was a loose grille, twice.",
      },
      FIXTURES.VENT_FIRING.watchers,
      ledger,
    );
    expect(warnings).toEqual([]);
  });

  it("defaults confidence to low rather than inventing certainty", () => {
    const { diagnosis } = enforceHonesty(
      { ...escalatingModelOutput, confidence: "absolute" },
      FIXTURES.WATER_FIRING.watchers,
      ledger,
    );
    expect(diagnosis.confidence).toBe("low");
  });
});

describe("ledger", () => {
  it("finds the disputed ventilation row when ventilation is active", () => {
    const disputed = disputedLedgerEntries(FIXTURES.VENT_FIRING.watchers, ledger);
    expect(disputed.map((d) => d.id)).toEqual(["L-003"]);
  });

  it("ignores the disputed ventilation row when only water is active", () => {
    const watchers = structuredClone(FIXTURES.WATER_FIRING.watchers);
    watchers[1].status = "quiet";
    expect(disputedLedgerEntries(watchers, ledger)).toEqual([]);
  });
});

describe("buildVoicePrompt", () => {
  it("tells the model escalation is ALLOWED for the water case, with the exact basis", () => {
    const prompt = buildVoicePrompt(FIXTURES.WATER_FIRING, ledger);
    expect(prompt).toMatch(/Escalation: ALLOWED/);
    expect(prompt).toMatch(/2 of 2 past water faults/);
    // The rulings block must never hand the model a percentage to parrot.
    // (Percent signs elsewhere in the prompt are Person B's own evidence text,
    // e.g. "91% of nominal", which is a measurement, not a probability.)
    const rulings = prompt.slice(prompt.indexOf("DETERMINISTIC RULINGS"));
    expect(rulings).not.toMatch(/%/);
    expect(rulings).not.toMatch(/probability|chance of/i);
  });

  it("tells the model escalation is NOT ALLOWED for the ventilation case", () => {
    const prompt = buildVoicePrompt(FIXTURES.VENT_FIRING, ledger);
    expect(prompt).toMatch(/Escalation: NOT ALLOWED/);
    expect(prompt).toMatch(/MUST set predicted_to_escalate=false/);
  });

  it("names the disputed ledger entry when one is relevant", () => {
    expect(buildVoicePrompt(FIXTURES.VENT_FIRING, ledger)).toMatch(/DISPUTED \(L-003\)/);
  });

  it("includes the four-episode history and the listener_validation note", () => {
    const prompt = buildVoicePrompt(FIXTURES.WATER_FIRING, ledger);
    expect(prompt).toMatch(/Only four episodes exist/);
    expect(prompt).toMatch(/young dragons' ears/);
  });
});
