import { z } from "zod";

export const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const instantSchema = z.iso.datetime({ precision: 3 });
export const dateSchema = z.iso.date();
export const timeZoneSchema = z.string().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return !/^[+-]/.test(value);
  } catch {
    return false;
  }
}, "Use an IANA time zone");

export const roleSchema = z.enum(["patient", "family", "caregiver"]);
export const inviteRoleSchema = roleSchema.exclude(["patient"]);
export const permissionSchema = z.enum([
  "care:read", "dose:verify", "escalation:respond", "insights:read",
]);

export const permissionsByRole = {
  family: ["care:read", "insights:read"],
  caregiver: ["care:read", "dose:verify", "escalation:respond"],
} as const satisfies Record<z.infer<typeof inviteRoleSchema>, readonly z.infer<typeof permissionSchema>[]>;

export const consentGrantSchema = z.strictObject({
  role: inviteRoleSchema,
  permissions: z.array(permissionSchema).min(1).max(4),
}).superRefine(({ role, permissions }, context) => {
  const allowed: readonly z.infer<typeof permissionSchema>[] = permissionsByRole[role];
  if (new Set(permissions).size !== permissions.length || permissions.some((permission) => !allowed.includes(permission))) {
    context.addIssue({ code: "custom", path: ["permissions"], message: "Use distinct permissions allowed for this role" });
  }
  if (!permissions.includes("care:read")) {
    context.addIssue({ code: "custom", path: ["permissions"], message: "Delegated access requires care:read" });
  }
});

export const profileInputSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(120),
  timeZone: timeZoneSchema,
});

export const amountSchema = z.strictObject({
  value: z.string().regex(/^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,6})?$/).refine((value) => Number(value) > 0),
  unit: z.string().trim().min(1).max(30),
});

export const medicationInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  prescribedAmount: amountSchema,
});

export const scheduleInputSchema = z.strictObject({
  medicationId: idSchema,
  localTimes: z.array(z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/)).min(1).max(12)
    .refine((times) => new Set(times).size === times.length, "Use distinct local times"),
  timeZone: timeZoneSchema,
  startDate: dateSchema,
  endDate: dateSchema.optional(),
}).refine(({ startDate, endDate }) => endDate === undefined || endDate >= startDate, {
  path: ["endDate"],
  message: "End date must be on or after start date",
});

export const doseStateSchema = z.enum([
  "scheduled", "patient_reported", "verified", "needs_review", "missed", "cancelled",
]);
export const doseEvidenceSchema = z.strictObject({
  medicationId: idSchema,
  medicationName: z.string().trim().min(1).max(120),
  amount: amountSchema,
  scheduledAt: instantSchema,
  administeredAt: instantSchema,
});
export const doseActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("patient_report"), evidence: doseEvidenceSchema }),
  z.strictObject({ kind: z.literal("caregiver_verification"), evidence: doseEvidenceSchema }),
  z.strictObject({ kind: z.literal("uncertain"), note: z.string().trim().min(1).max(500).optional() }),
  z.strictObject({ kind: z.literal("needs_help"), note: z.string().trim().min(1).max(500).optional() }),
]);

export const appointmentInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  startsAt: instantSchema,
  endsAt: instantSchema,
  location: z.string().trim().min(1).max(250).optional(),
}).refine(({ startsAt, endsAt }) => endsAt > startsAt, {
  path: ["endsAt"],
  message: "End time must be after start time",
});

export type Role = z.infer<typeof roleSchema>;
export type Permission = z.infer<typeof permissionSchema>;
export type ConsentGrant = z.infer<typeof consentGrantSchema>;
export type DoseState = z.infer<typeof doseStateSchema>;
export type DoseAction = z.infer<typeof doseActionSchema>;
