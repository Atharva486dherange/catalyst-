import { describe, expect, it } from "vitest";
import { apiContracts, pageQuerySchema } from "../../shared/contracts/api";
import { amountSchema, consentGrantSchema, scheduleInputSchema } from "../../shared/types/domain";

describe("SAATHI contracts", () => {
  it("rejects duplicate or unauthorized delegation", () => {
    expect(consentGrantSchema.safeParse({
      role: "family", permissions: ["care:read", "insights:read"],
    }).success).toBe(true);
    expect(consentGrantSchema.safeParse({
      role: "family", permissions: ["care:read", "dose:verify"],
    }).success).toBe(false);
    expect(consentGrantSchema.safeParse({
      role: "caregiver", permissions: ["care:read", "care:read"],
    }).success).toBe(false);
    expect(consentGrantSchema.safeParse({
      role: "caregiver", permissions: ["dose:verify"],
    }).success).toBe(false);
  });

  it("requires explicit dose evidence and rejects server-controlled input fields", () => {
    const evidence = {
      medicationId: "med-1", medicationName: "Example",
      amount: { value: "0.25", unit: "mg" }, scheduledAt: "2026-11-15T08:00:00.000Z", administeredAt: "2026-11-15T08:01:00.000Z",
    };
    const { body } = apiContracts.reportDose;
    expect(body.safeParse({ kind: "patient_report", evidence }).success).toBe(true);
    expect(body.safeParse({ kind: "caregiver_verification", evidence }).success).toBe(true);
    expect(body.safeParse({ kind: "patient_report", evidence: {} }).success).toBe(false);
    expect(body.safeParse({ kind: "patient_report", evidence, verifiedAt: evidence.scheduledAt }).success).toBe(false);
    expect(amountSchema.safeParse({ value: "0.000", unit: "mg" }).success).toBe(false);
  });

  it("requires valid schedule times, dates and time zones", () => {
    const schedule = {
      medicationId: "med-1", localTimes: ["08:00"],
      timeZone: "Asia/Kolkata", startDate: "2026-11-15",
    };
    expect(scheduleInputSchema.safeParse(schedule).success).toBe(true);
    expect(scheduleInputSchema.safeParse({ ...schedule, localTimes: ["08:00", "08:00"] }).success).toBe(false);
    expect(scheduleInputSchema.safeParse({ ...schedule, endDate: "2026-11-14" }).success).toBe(false);
    expect(scheduleInputSchema.safeParse({ ...schedule, timeZone: "+05:30" }).success).toBe(false);
  });

  it("sets predictable pagination defaults and bounds", () => {
    expect(pageQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(pageQuerySchema.parse({ limit: "50", cursor: "opaque" })).toEqual({ limit: 50, cursor: "opaque" });
    expect(pageQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
  });

  it("validates escalation query filters", () => {
    const { query } = apiContracts.listEscalations;
    expect(query.parse({})).toEqual({ limit: 20 });
    expect(query.parse({ status: "unresolved" })).toEqual({ limit: 20, status: "unresolved" });
    expect(query.parse({ status: "open", limit: "10" })).toEqual({ limit: 10, status: "open" });
    expect(query.safeParse({ status: "invalid" }).success).toBe(false);
  });
});
