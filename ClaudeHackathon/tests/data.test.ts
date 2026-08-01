/**
 * Person A — tests for the data access layer.
 *
 * These run against the real prepared_data.json, not a fixture. That is
 * deliberate: the point of this suite is to prove the loader finds and reads
 * the actual file from the cwd the app runs in, and that the numbers
 * downstream code depends on are really in there.
 */

import { describe, it, expect } from "vitest";
import {
  getWindow,
  getRecordAt,
  getBaseline,
  getDerivedConstants,
  getTimestampRange,
  loadAllRecords,
} from "../lib/data";

describe("data access layer", () => {
  it("getWindow returns exactly hoursBack records ending at the target hour", () => {
    const { records } = getWindow("2026-07-05T04:00:00Z", 12);
    expect(records.length).toBe(12);
    expect(records[records.length - 1].timestamp).toBe("2026-07-05T04:00:00Z");
  });

  it("getWindow scales to a 48h window (Person D's chart)", () => {
    const { records } = getWindow("2026-07-05T04:00:00Z", 48);
    expect(records.length).toBe(48);
  });

  it("getRecordAt between two hourly readings returns the earlier one", () => {
    const r = getRecordAt("2026-07-05T04:37:00Z");
    expect(r?.timestamp).toBe("2026-07-05T04:00:00Z");
  });

  it("getWindow at the very first timestamp doesn't crash and returns itself", () => {
    const all = loadAllRecords();
    const { records } = getWindow(all[0].timestamp, 12);
    expect(records.length).toBe(1);
    expect(records[0].timestamp).toBe(all[0].timestamp);
  });

  it("getBaseline returns the three expected channels", () => {
    const b = getBaseline();
    expect(b).toHaveProperty("residual");
    expect(b).toHaveProperty("water_pressure_kpa");
    expect(b).toHaveProperty("vibration_level");
  });

  it("getDerivedConstants exposes the escalation rule without any hardcoded threshold elsewhere", () => {
    const dc = getDerivedConstants();
    expect(dc.escalation.threshold_kpa_per_hour).toBe(-5);
    expect(dc.escalation.historical_base_rate.n_water_episodes).toBe(2);
  });

  it("novelty fields are present on records (GMM ran)", () => {
    const all = loadAllRecords();
    const sample = all.find((r) => r.novelty_score !== undefined);
    expect(sample).toBeDefined();
  });
});

describe("windowing edge cases", () => {
  it("the window start is exclusive and the end is inclusive", () => {
    const target = "2026-07-05T04:00:00Z";
    const { records } = getWindow(target, 3);
    // 3h back from 04:00 is 01:00, which is excluded; 04:00 is included.
    expect(records.map((r) => r.timestamp)).toEqual([
      "2026-07-05T02:00:00Z",
      "2026-07-05T03:00:00Z",
      "2026-07-05T04:00:00Z",
    ]);
  });

  it("getRecordAt before the series begins returns null rather than the first record", () => {
    expect(getRecordAt("2026-06-01T00:00:00Z")).toBeNull();
  });

  it("getRecordAt after the series ends returns the last record", () => {
    const all = loadAllRecords();
    const last = all[all.length - 1];
    expect(getRecordAt("2027-01-01T00:00:00Z")?.timestamp).toBe(last.timestamp);
  });

  it("a window entirely outside the series is empty, not an error", () => {
    expect(getWindow("2026-06-01T00:00:00Z", 12).records.length).toBe(0);
  });

  it("getTimestampRange matches the first and last record", () => {
    const all = loadAllRecords();
    const { min, max } = getTimestampRange();
    expect(min).toBe(all[0].timestamp);
    expect(max).toBe(all[all.length - 1].timestamp);
  });
});

describe("prepared_data.json integrity", () => {
  it("records are sorted ascending — getRecordAt's early break depends on it", () => {
    const all = loadAllRecords();
    for (let i = 1; i < all.length; i += 1) {
      expect(all[i - 1].timestamp <= all[i].timestamp).toBe(true);
    }
  });

  it("the series is a continuous hourly grid with no missing hours", () => {
    const all = loadAllRecords();
    for (let i = 1; i < all.length; i += 1) {
      const delta = new Date(all[i].timestamp).getTime() - new Date(all[i - 1].timestamp).getTime();
      expect(delta).toBe(60 * 60 * 1000);
    }
  });

  it("pressure_slope_6h really is nullable — the first hours have no 6h history", () => {
    const all = loadAllRecords();
    const nulls = all.filter((r) => r.pressure_slope_6h === null);
    // Consumers must null-guard this field; it is not a type-level formality.
    expect(nulls.length).toBeGreaterThan(0);
    expect(nulls.every((r) => all.indexOf(r) < 6)).toBe(true);
  });

  it("system_status and sound_event stay inside the documented unions", () => {
    const statuses = new Set(loadAllRecords().map((r) => r.system_status));
    const sounds = new Set(loadAllRecords().map((r) => r.sound_event));
    for (const s of statuses) expect(["stable", "warning", "critical", "failed"]).toContain(s);
    for (const s of sounds) expect(["normal", "hum", "rattle"]).toContain(s);
  });
});

describe("derived constants are the single source of truth", () => {
  it("ventilation_threshold is present so watchers never hardcode -0.5", () => {
    const { ventilation_threshold } = getDerivedConstants();
    expect(ventilation_threshold.threshold).toBeCloseTo(-0.5, 2);
    expect(ventilation_threshold.faulty_mean).toBeLessThan(ventilation_threshold.healthy_mean);
  });

  it("the residual baseline is the real distribution, not the 0.0006 placeholder", () => {
    // Person B's CONTRACTS.md flagged a 35-sigma contradiction built on
    // std=0.0006. The real std is ~0.015, which resolves it — see
    // docs/person-a-handoff.md.
    const { residual } = getBaseline();
    expect(residual.std).toBeGreaterThan(0.01);
    const exampleResidual = -0.021;
    const sigma = Math.abs((exampleResidual - residual.mean) / residual.std);
    expect(sigma).toBeLessThan(3);
  });

  it("exposes four episodes, two water and two ventilation", () => {
    const { episodes } = getDerivedConstants();
    expect(episodes.length).toBe(4);
    expect(episodes.filter((e) => e.subsystem === "water").length).toBe(2);
    expect(episodes.filter((e) => e.subsystem === "ventilation").length).toBe(2);
  });

  it("airflow_model carries the regression fit used to build residual", () => {
    const { airflow_model } = getDerivedConstants();
    expect(airflow_model.r_squared).toBeGreaterThan(0.99);
    expect(airflow_model.n_rows_used).toBeGreaterThan(0);
  });
});

describe("GMM novelty layer", () => {
  it("every record carries both novelty fields", () => {
    const all = loadAllRecords();
    expect(all.every((r) => typeof r.novelty_score === "number")).toBe(true);
    expect(all.every((r) => typeof r.is_novel === "boolean")).toBe(true);
  });

  it("is_novel agrees with novelty_score against the published threshold", () => {
    const threshold = getDerivedConstants().novelty_model?.threshold;
    expect(threshold).toBeDefined();
    for (const r of loadAllRecords()) {
      expect(r.is_novel).toBe(r.novelty_score! < threshold!);
    }
  });

  it("novelty flags a minority of hours, not everything", () => {
    const all = loadAllRecords();
    const novel = all.filter((r) => r.is_novel).length;
    expect(novel).toBeGreaterThan(0);
    expect(novel).toBeLessThan(all.length / 2);
  });
});

describe("caching", () => {
  it("repeated calls hand back the same cached array (read-only by contract)", () => {
    expect(loadAllRecords()).toBe(loadAllRecords());
  });
});
