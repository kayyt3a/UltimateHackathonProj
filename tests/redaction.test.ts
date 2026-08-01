import { describe, expect, it } from "vitest";
import { enforceHonesty } from "@/lib/voice";
import { FIXTURES } from "@/lib/fixtures/watchers";
import LEDGER from "@/data/knowledge_ledger.json";
import type { LedgerEntry } from "@/lib/types";

const ledger = LEDGER as LedgerEntry[];

const base = {
  entry_cited: "Entry 1",
  subsystem_scope: "water",
  mode: "plumbing",
  headline: "Water pressure is falling fast",
  recommended_action: "Wake the elders and close the main valve now.",
  reasoning: "Cloudy wrote that when the pressure slides, the tanks run dry before morning.",
  predicted_to_escalate: true,
  escalation_basis:
    "pressure has been falling at 9.4 kPa/h; this pattern preceded total failure in 2 of 2 past water faults",
  hours_to_critical_estimate: 24,
  speech_text: "Water pressure is dropping fast. Wake the elders.",
  confidence: "moderate",
  caveat: "Only four episodes exist, so this is a pattern, not a promise.",
};

/**
 * A structured field with one correct value can be repaired in place. Free
 * prose cannot, so it becomes a hard violation: the caller retries the model,
 * and redacts if it reoffends. Nothing with a fabricated number ever ships.
 */
describe("hard vs soft honesty violations", () => {
  it("repairs a bad escalation_basis in place — not a hard violation", () => {
    const audit = enforceHonesty(
      { ...base, escalation_basis: "87% chance of total failure tonight" },
      FIXTURES.WATER_FIRING.watchers,
      ledger,
    );
    expect(audit.hardViolations).toEqual([]);
    expect(audit.diagnosis.escalation_basis).toMatch(/2 of 2 past water faults/);
    expect(audit.diagnosis.escalation_basis).not.toMatch(/87%/);
  });

  it("treats a percentage in the reasoning as a HARD violation", () => {
    const audit = enforceHonesty(
      { ...base, reasoning: "There is an 87% chance the tanks run dry before dawn." },
      FIXTURES.WATER_FIRING.watchers,
      ledger,
    );
    expect(audit.hardViolations.length).toBeGreaterThan(0);
    expect(audit.hardViolations.join(" ")).toMatch(/reasoning/);
  });

  it("treats a probability claim in speech_text as a HARD violation — it gets read aloud", () => {
    const audit = enforceHonesty(
      { ...base, speech_text: "There is a high probability the water fails tonight." },
      FIXTURES.WATER_FIRING.watchers,
      ledger,
    );
    expect(audit.hardViolations.join(" ")).toMatch(/speech_text/);
  });

  it("catches odds, likelihood and 'chance of' phrasing, not just the % sign", () => {
    for (const reasoning of [
      "The odds are it fails tonight.",
      "There is a real chance of total failure.",
      "The likelihood is high.",
      "There is a 60 percent chance the tanks empty.",
      "It is 70% likely to fail by dawn.",
    ]) {
      const audit = enforceHonesty({ ...base, reasoning }, FIXTURES.WATER_FIRING.watchers, ledger);
      expect(audit.hardViolations.length, reasoning).toBeGreaterThan(0);
    }
  });

  it("does NOT fire on legitimate percentage readings", () => {
    // Person B's ventilation evidence literally says "airflow 62% of nominal".
    // Flagging that would burn two API calls and redact a good sentence on
    // every single ventilation briefing.
    for (const reasoning of [
      "Airflow is at 62% of nominal and the rattle is at 58 dB, exactly what Cloudy described.",
      "Pressure has fallen 9.4 kPa/h for three hours; the tanks are down to 30% and you will be thirsty.",
      "The vent is running at 94 percent of nominal, so the cold you feel is not the fans.",
    ]) {
      const audit = enforceHonesty({ ...base, reasoning }, FIXTURES.WATER_FIRING.watchers, ledger);
      expect(audit.hardViolations, reasoning).toEqual([]);
    }
  });

  it("reports no violations for a clean escalating briefing", () => {
    const audit = enforceHonesty({ ...base }, FIXTURES.WATER_FIRING.watchers, ledger);
    expect(audit.hardViolations).toEqual([]);
    expect(audit.warnings).toEqual([]);
  });

  it("still hard-fails prose even while deterministically clearing escalation", () => {
    // Ventilation: escalation must be refused AND the bad prose caught.
    const audit = enforceHonesty(
      {
        ...base,
        entry_cited: "Entry 3",
        reasoning: "There is a 90% chance the fan seizes; the log disputes the bearing theory.",
      },
      FIXTURES.VENT_FIRING.watchers,
      ledger,
    );
    expect(audit.diagnosis.predicted_to_escalate).toBe(false);
    expect(audit.diagnosis.escalation_basis).toBeNull();
    expect(audit.hardViolations.length).toBeGreaterThan(0);
  });
});
