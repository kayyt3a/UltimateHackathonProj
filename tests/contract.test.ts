import { describe, expect, it } from "vitest";
import { canonicalEntry, normaliseWatcherBundle } from "@/lib/contract";
import { aggregate } from "@/lib/aggregate";
import {
  rulePredictedEscalation,
  isDisputed,
  ledgerEntryLabel,
  relevantLedgerEntries,
  disputedLedgerEntries,
} from "@/lib/escalation";
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

describe("Person B's ledger shape (ClaudeHackathon/lib/types.ts LedgerRow)", () => {
  // Their reconciliation agent emits no `entry` and no `subsystem` field. If we
  // matched on those alone, ZERO rows would ever be relevant and disputes would
  // silently stop surfacing — the Voice agent claiming certainty over contested
  // knowledge, with nothing in warnings[] to show for it.
  const theirRow = (over: Record<string, unknown> = {}) => ({
    id: "entry_3",
    source_label: "Cloudy's notes — Entry 3",
    claim: "The fans can turn at full power while moving no air.",
    verdict: "supported",
    evidence: "airflow = 0.1250 x power - 1.5000, r2 = 0.999999",
    conflicts_with: null,
    data_leans_toward: null,
    operational_rule: "residual < -0.5006",
    note_to_dragons: "The fans are spinning but the air is not moving.",
    timestamp_added: "2026-08-01T09:00:00Z",
    ...over,
  });

  it("finds their row relevant via id / source_label, with no entry field", () => {
    const relevant = relevantLedgerEntries(FIXTURES.VENT_FIRING.watchers, [theirRow()]);
    expect(relevant).toHaveLength(1);
  });

  it("resolves the note label from id or source_label", () => {
    expect(ledgerEntryLabel(theirRow())).toBe("Entry 3");
    expect(ledgerEntryLabel({ source_label: "Cloudy's notes — Entry 1" })).toBe("Entry 1");
    expect(ledgerEntryLabel({ id: "live_1754030000000" })).toBeNull();
  });

  it("treats their verdict vocabulary correctly", () => {
    expect(isDisputed(theirRow({ verdict: "disputed" }))).toBe(true);
    // A refuted note must not be cited as established fact either.
    expect(isDisputed(theirRow({ verdict: "refuted" }))).toBe(true);
    expect(isDisputed(theirRow({ verdict: "supported" }))).toBe(false);
    expect(isDisputed(theirRow({ verdict: "untestable" }))).toBe(false);
  });

  it("treats a non-null conflicts_with pointer as the disagreement", () => {
    expect(isDisputed(theirRow({ conflicts_with: "entry_1" }))).toBe(true);
    expect(isDisputed(theirRow({ conflicts_with: null }))).toBe(false);
  });

  it("surfaces their disputed row through the full guardrail", () => {
    const disputed = disputedLedgerEntries(FIXTURES.VENT_FIRING.watchers, [
      theirRow({ verdict: "refuted" }),
    ]);
    expect(disputed).toHaveLength(1);
  });
});
