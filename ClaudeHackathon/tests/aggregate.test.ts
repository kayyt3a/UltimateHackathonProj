import { describe, expect, it } from "vitest";
import { aggregate, firingWatchers, severityWarnings } from "@/lib/aggregate";
import { FIXTURES } from "@/lib/fixtures/watchers";
import type { WatcherOutput, WatcherStatus } from "@/lib/types";

function watcher(
  entry: string,
  status: WatcherStatus,
  subsystem: "water" | "ventilation" | null = null,
): WatcherOutput {
  return { entry, status, subsystem, evidence: [], reasoning: "" };
}

const FOUR = (statuses: WatcherStatus[]): WatcherOutput[] =>
  ["Entry 1", "Entry 3", "Entry 4", "Entry 5"].map((e, i) => watcher(e, statuses[i]));

describe("aggregate — worst-of-4", () => {
  it("all quiet -> green", () => {
    expect(aggregate(FOUR(["quiet", "quiet", "quiet", "quiet"]))).toBe("green");
  });

  it("one watching -> amber", () => {
    expect(aggregate(FOUR(["quiet", "watching", "quiet", "quiet"]))).toBe("amber");
  });

  it("one firing -> red", () => {
    expect(aggregate(FOUR(["quiet", "quiet", "firing", "quiet"]))).toBe("red");
  });

  it("multiple firing -> red", () => {
    expect(aggregate(FOUR(["firing", "quiet", "firing", "watching"]))).toBe("red");
  });

  it("firing outranks watching regardless of order", () => {
    expect(aggregate(FOUR(["watching", "watching", "watching", "firing"]))).toBe("red");
    expect(aggregate(FOUR(["firing", "watching", "watching", "watching"]))).toBe("red");
  });

  it("all watching -> amber", () => {
    expect(aggregate(FOUR(["watching", "watching", "watching", "watching"]))).toBe("amber");
  });

  it("empty input -> green", () => {
    expect(aggregate([])).toBe("green");
  });
});

describe("aggregate — the traffic light must never hallucinate green", () => {
  it("takes no listener_validation argument at all", () => {
    // Entry 2 is informational only. Its absence from the signature is the
    // guarantee: there is no code path by which it can move the light.
    expect(aggregate.length).toBe(1);
  });

  it("fails upward to amber on an unrecognised status, never to green", () => {
    const drifted = FOUR(["quiet", "quiet", "quiet", "quiet"]);
    drifted[2].status = "degraded" as WatcherStatus;
    expect(aggregate(drifted)).toBe("amber");
    expect(severityWarnings(drifted)[0]).toMatch(/unknown status "degraded"/);
  });

  it("warns when no watcher output arrived", () => {
    expect(severityWarnings([])[0]).toMatch(/No watcher output/);
  });

  it("is clean for well-formed input", () => {
    expect(severityWarnings(FOUR(["quiet", "watching", "firing", "quiet"]))).toEqual([]);
  });
});

describe("aggregate — against the demo fixtures", () => {
  it("2026-07-04T23:00 all quiet -> green", () => {
    expect(aggregate(FIXTURES.ALL_QUIET.watchers)).toBe("green");
  });

  it("2026-07-05T06:00 Entry 1 firing on water (sustained) -> red", () => {
    expect(aggregate(FIXTURES.WATER_FIRING.watchers)).toBe("red");
  });

  it("2026-07-05T04:00 Entry 1 watching on water (not yet sustained) -> amber", () => {
    expect(aggregate(FIXTURES.WATER_WATCHING.watchers)).toBe("amber");
  });

  it("2026-07-10T06:00 Entry 3 firing -> red", () => {
    expect(aggregate(FIXTURES.VENT_FIRING.watchers)).toBe("red");
  });

  it("firingWatchers reports only the firing entries", () => {
    expect(firingWatchers(FIXTURES.WATER_FIRING.watchers).map((w) => w.entry)).toEqual([
      "Entry 1",
    ]);
    expect(firingWatchers(FIXTURES.ALL_QUIET.watchers)).toEqual([]);
  });
});
