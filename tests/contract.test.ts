import { describe, expect, it } from "vitest";
import { canonicalEntry, normaliseWatcherBundle } from "@/lib/contract";
import { aggregate } from "@/lib/aggregate";
import { rulePredictedEscalation, isDisputed } from "@/lib/escalation";
import { FIXTURES } from "@/lib/fixtures/watchers";

describe("canonicalEntry", () => {
  it("accepts the shapes a teammate might plausibly emit", () => {
    for (const raw of ["Entry 1", "entry_1", "ENTRY 1", "entry-1", "Entry 1 — Water pressure"]) {
      expect(canonicalEntry(raw), raw).toBe("Entry 1");
    }
  });

  it("returns null for anything it cannot recognise", () => {
    for (const raw of ["water watcher", "", null, 7, undefined]) {
      expect(canonicalEntry(raw)).toBeNull();
    }
  });
});

describe("normaliseWatcherBundle — Person B handshake", () => {
  it("passes a well-formed bundle through unchanged and reports no problems", () => {
    const { bundle, problems } = normaliseWatcherBundle(FIXTURES.WATER_FIRING);
    expect(problems).toEqual([]);
    expect(bundle.watchers).toHaveLength(4);
    expect(aggregate(bundle.watchers)).toBe("red");
    expect(rulePredictedEscalation(bundle.watchers).allowed).toBe(true);
  });

  it("recovers escalation when entry labels are styled differently", () => {
    // Without normalisation this reads as "Entry 1 is not firing" and the
    // escalation rule silently never fires.
    const theirs = {
      watchers: [
        {
          entry: "entry_1",
          status: "FIRING",
          subsystem: "Water",
          evidence: [
            { hour: "2026-07-05T04:00:00Z", signal: "pressure_slope_6h", value: -9.4, threshold: -5 },
          ],
          reasoning: "Pressure falling.",
        },
        { entry: "entry_3", status: "ok", subsystem: "vent", evidence: [], reasoning: "" },
        { entry: "entry_4", status: "ok", subsystem: "Water", evidence: [], reasoning: "" },
        { entry: "entry_5", status: "ok", subsystem: null, evidence: [], reasoning: "" },
      ],
      listener_validation: { entry: "entry_2", accuracy_vs_system_status: 1, note: "ok" },
    };

    const { bundle, problems } = normaliseWatcherBundle(theirs);
    expect(problems).toEqual([]);
    expect(aggregate(bundle.watchers)).toBe("red");
    expect(rulePredictedEscalation(bundle.watchers).allowed).toBe(true);
    expect(bundle.listener_validation.entry).toBe("Entry 2");
  });

  it("reports an unrecognised entry rather than silently disarming the rules", () => {
    const { problems } = normaliseWatcherBundle({
      watchers: [{ entry: "the water one", status: "firing", subsystem: "water", evidence: [], reasoning: "" }],
      listener_validation: FIXTURES.ALL_QUIET.listener_validation,
    });
    expect(problems.join(" ")).toMatch(/unrecognised entry "the water one"/);
    expect(problems.join(" ")).toMatch(/cannot license an escalation/);
  });

  it("coerces an unreadable status to watching (amber), never quiet (green)", () => {
    const { bundle, problems } = normaliseWatcherBundle({
      watchers: [{ entry: "Entry 1", status: "weird", subsystem: "water", evidence: [], reasoning: "" }],
      listener_validation: FIXTURES.ALL_QUIET.listener_validation,
    });
    expect(bundle.watchers[0].status).toBe("watching");
    expect(aggregate(bundle.watchers)).toBe("amber");
    expect(problems.join(" ")).toMatch(/treated as "watching" \(amber\) rather than quiet/);
  });

  it("flags missing watchers", () => {
    const { problems } = normaliseWatcherBundle({
      watchers: [{ entry: "Entry 1", status: "quiet", subsystem: "water", evidence: [], reasoning: "" }],
      listener_validation: FIXTURES.ALL_QUIET.listener_validation,
    });
    expect(problems.join(" ")).toMatch(/Entry 3 is missing/);
    expect(problems.join(" ")).toMatch(/Entry 5 is missing/);
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, 42, "nope", {}, { watchers: "not an array" }]) {
      const { bundle, problems } = normaliseWatcherBundle(junk);
      expect(Array.isArray(bundle.watchers)).toBe(true);
      expect(problems.length).toBeGreaterThan(0);
      // Never throws, and an empty watcher list is green only because there is
      // genuinely nothing to report — the problems array says why.
      expect(() => aggregate(bundle.watchers)).not.toThrow();
    }
  });

  it("keeps non-numeric evidence from poisoning the escalation rule", () => {
    const { bundle, problems } = normaliseWatcherBundle({
      watchers: [
        {
          entry: "Entry 1",
          status: "firing",
          subsystem: "water",
          evidence: [{ hour: "x", signal: "pressure_slope_6h", value: "very bad", threshold: -5 }],
          reasoning: "",
        },
      ],
      listener_validation: FIXTURES.ALL_QUIET.listener_validation,
    });
    expect(problems.join(" ")).toMatch(/non-numeric value\/threshold/);
    expect(typeof bundle.watchers[0].evidence[0].value).toBe("number");
  });
});

describe("isDisputed — tolerant of ledger vocabulary", () => {
  it("recognises the field and word variants a teammate might use", () => {
    expect(isDisputed({ status: "disputed" })).toBe(true);
    expect(isDisputed({ status: "DISPUTED" })).toBe(true);
    expect(isDisputed({ state: "contested" })).toBe(true);
    expect(isDisputed({ verdict: "conflicting" })).toBe(true);
    expect(isDisputed({ disputed: true })).toBe(true);
  });

  it("does not treat settled knowledge as disputed", () => {
    expect(isDisputed({ status: "confirmed" })).toBe(false);
    expect(isDisputed({ status: "unverified" })).toBe(false);
    expect(isDisputed({})).toBe(false);
  });
});
