import { z } from "zod";
import {
  appointmentInputSchema, consentGrantSchema, doseActionSchema, doseStateSchema, idSchema,
  instantSchema, medicationInputSchema, permissionSchema, profileInputSchema, roleSchema, scheduleInputSchema,
} from "../types/domain";

export const errorCodeSchema = z.enum([
  "INVALID_INPUT", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "CONFLICT",
  "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "RATE_LIMITED", "INTERNAL", "UNAVAILABLE",
]);

export const idempotencyKeySchema = z.uuidv4();

export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.uuid(),
    fields: z.array(z.strictObject({ path: z.string(), message: z.string() })).optional(),
  }),
});

export function successSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({ data });
}

export const pageQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/).optional()
    .transform((value) => value === undefined ? 20 : Number(value)),
});

function pageSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const timeRangePageQuerySchema = pageQuerySchema.extend({
  from: instantSchema.optional(),
  to: instantSchema.optional(),
}).refine(({ from, to }) => from === undefined || to === undefined || to > from, {
  path: ["to"], message: "End time must follow start time",
});

export const healthSchema = z.strictObject({ status: z.literal("ok") });
export const circleSchema = profileInputSchema.extend({ id: idSchema, updatedAt: instantSchema });
export const circleSummarySchema = z.strictObject({ id: idSchema, displayName: z.string(), role: roleSchema, permissions: z.array(permissionSchema) });
export const inviteCreateSchema = z.strictObject({ email: z.email().max(254), consent: consentGrantSchema });
export const inviteAcceptSchema = z.strictObject({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const invitationSchema = z.strictObject({
  id: idSchema, email: z.email(), state: z.enum(["pending", "accepted", "revoked", "expired"]), expiresAt: instantSchema,
});
export const membershipSchema = z.strictObject({
  uid: idSchema, email: z.email(), consent: consentGrantSchema, state: z.enum(["active", "revoked"]), updatedAt: instantSchema,
});

export const escalationAssigneeSchema = z.strictObject({ caregiverUid: idSchema.nullable() });

export const medicationSchema = medicationInputSchema.extend({
  id: idSchema, state: z.enum(["active", "archived"]), updatedAt: instantSchema,
});
export const scheduleSchema = scheduleInputSchema.safeExtend({
  id: idSchema, state: z.enum(["active", "ended"]), needsReview: z.literal(true).optional(), updatedAt: instantSchema,
});
export const doseSchema = z.strictObject({
  id: idSchema, medicationId: idSchema, scheduleId: idSchema, scheduledAt: instantSchema,
  medicationSnapshot: medicationInputSchema, state: doseStateSchema,
  patientReportedAt: instantSchema.nullable(), verifiedAt: instantSchema.nullable(), updatedAt: instantSchema,
});
export const appointmentSchema = appointmentInputSchema.safeExtend({
  id: idSchema, state: z.enum(["scheduled", "cancelled"]), updatedAt: instantSchema,
});
export const escalationOutcomeSchema = z.enum(["checked_in", "referred_for_review", "unable_to_reach"]);
export const resolveEscalationSchema = z.strictObject({ outcome: escalationOutcomeSchema });
export const escalationQuerySchema = pageQuerySchema.extend({
  status: z.enum(["unresolved", "open", "claimed", "resolved"]).optional(),
});
export const escalationSchema = z.strictObject({
  id: idSchema, doseId: idSchema, assigneeUid: idSchema.nullable(), ownerUid: idSchema.nullable(), state: z.enum(["open", "claimed", "resolved"]),
  openedAt: instantSchema, outcome: escalationOutcomeSchema.nullable(), resolvedAt: instantSchema.nullable(), updatedAt: instantSchema,
});
export const extractionConsentSchema = z.literal("true");
export const extractionMediaTypeSchema = z.enum(["image/jpeg", "image/png", "application/pdf"]);
export const extractionReviewSchema = z.strictObject({
  items: z.array(medicationInputSchema).min(1).max(30),
});
export const extractionSchema = z.strictObject({
  id: idSchema, state: z.enum(["pending_review", "reviewed"]),
  items: z.array(z.strictObject({
    name: z.string().max(120).nullable(), amountText: z.string().max(100).nullable(),
    scheduleText: z.string().max(250).nullable(),
  })).max(30),
  reviewedItems: z.array(medicationInputSchema).max(30).nullable(), updatedAt: instantSchema,
});
export const insightsQuerySchema = z.strictObject({
  from: instantSchema, to: instantSchema,
}).refine(({ from, to }) => Date.parse(to) > Date.parse(from) &&
  Date.parse(to) - Date.parse(from) <= 31 * 24 * 60 * 60 * 1000, { path: ["to"], message: "Use a range of up to 31 days" });
export const insightsSchema = insightsQuerySchema.safeExtend({
  scheduled: z.number().int().nonnegative(),
  patientReported: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  missed: z.number().int().nonnegative(),
});
export const auditEventSchema = z.strictObject({
  id: idSchema, action: z.string(), actorUid: idSchema.nullable(),
  resourceId: idSchema, createdAt: instantSchema,
});

export const apiContracts = {
  health: { response: successSchema(healthSchema) },
  listCircles: { query: pageQuerySchema, response: successSchema(pageSchema(circleSummarySchema)) },
  createCircle: { body: profileInputSchema, response: successSchema(circleSchema) },
  getCircle: { response: successSchema(circleSchema) },
  updateCircle: { body: profileInputSchema, response: successSchema(circleSchema) },
  listInvitations: { query: pageQuerySchema, response: successSchema(pageSchema(invitationSchema)) },
  createInvitation: { body: inviteCreateSchema, response: successSchema(invitationSchema) },
  acceptInvitation: { body: inviteAcceptSchema, response: successSchema(circleSummarySchema) },
  revokeInvitation: { response: successSchema(invitationSchema) },
  listMemberships: { query: pageQuerySchema, response: successSchema(pageSchema(membershipSchema)) },
  getEscalationAssignee: { response: successSchema(escalationAssigneeSchema) },
  setEscalationAssignee: { body: escalationAssigneeSchema, response: successSchema(escalationAssigneeSchema) },
  revokeMembership: { response: successSchema(membershipSchema) },
  listMedications: { query: pageQuerySchema, response: successSchema(pageSchema(medicationSchema)) },
  createMedication: { body: medicationInputSchema, response: successSchema(medicationSchema) },
  updateMedication: { body: medicationInputSchema, response: successSchema(medicationSchema) },
  archiveMedication: { response: successSchema(medicationSchema) },
  listSchedules: { query: pageQuerySchema, response: successSchema(pageSchema(scheduleSchema)) },
  createSchedule: { body: scheduleInputSchema, response: successSchema(scheduleSchema) },
  endSchedule: { response: successSchema(scheduleSchema) },
  listDoses: { query: timeRangePageQuerySchema, response: successSchema(pageSchema(doseSchema)) },
  getDose: { response: successSchema(doseSchema) },
  reportDose: { body: doseActionSchema, response: successSchema(doseSchema) },
  listAppointments: { query: timeRangePageQuerySchema, response: successSchema(pageSchema(appointmentSchema)) },
  createAppointment: { body: appointmentInputSchema, response: successSchema(appointmentSchema) },
  updateAppointment: { body: appointmentInputSchema, response: successSchema(appointmentSchema) },
  cancelAppointment: { response: successSchema(appointmentSchema) },
  listEscalations: { query: escalationQuerySchema, response: successSchema(pageSchema(escalationSchema)) },
  claimEscalation: { response: successSchema(escalationSchema) },
  resolveEscalation: { body: resolveEscalationSchema, response: successSchema(escalationSchema) },
  createExtraction: { mediaType: extractionMediaTypeSchema, consent: extractionConsentSchema, response: successSchema(extractionSchema) },
  getExtraction: { response: successSchema(extractionSchema) },
  reviewExtraction: { body: extractionReviewSchema, response: successSchema(extractionSchema) },
  getInsights: { query: insightsQuerySchema, response: successSchema(insightsSchema) },
  listAudit: { query: pageQuerySchema, response: successSchema(pageSchema(auditEventSchema)) },
} as const;

export type ApiErrorCode = z.infer<typeof errorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiOperation = keyof typeof apiContracts;
export type ApiBody<Operation extends ApiOperation> =
  (typeof apiContracts)[Operation] extends { body: infer Body extends z.ZodType } ? z.input<Body> : never;
export type ApiQuery<Operation extends ApiOperation> =
  (typeof apiContracts)[Operation] extends { query: infer Query extends z.ZodType } ? z.input<Query> : never;
export type ApiResponse<Operation extends keyof typeof apiContracts> =
  z.output<(typeof apiContracts)[Operation]["response"]>;
