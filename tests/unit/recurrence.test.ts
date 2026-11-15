import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { scheduleTime, stableId } from "../../functions/src/medications/recurrence";

describe("medication recurrence", () => {
  it("flags nonexistent local times and uses the first repeated time", () => {
    expect(scheduleTime(Temporal.PlainDate.from("2026-03-08"), "02:30", "America/New_York")).toBeNull();
    const repeated = scheduleTime(Temporal.PlainDate.from("2026-11-01"), "01:30", "America/New_York");
    expect(repeated).toBe(Date.parse("2026-11-01T05:30:00.000Z"));
  });

  it("uses stable, distinct identifiers for repeated jobs and different occurrences", () => {
    const dose = stableId("dose", "schedule", "1000");
    expect(stableId("dose", "schedule", "1000")).toBe(dose);
    expect(stableId("dose", "schedule", "2000")).not.toBe(dose);
    expect(stableId("email", "schedule", "1000")).not.toBe(dose);
  });
});
