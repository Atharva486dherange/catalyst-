import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import type { DocumentData, DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import type { ApiBody, ApiQuery } from "@/shared/contracts/api";
import { canRespond } from "@/functions/src/care-circle/task";
import { hour } from "@/functions/src/medications/recurrence";
import { audit, byId, conflict, exists, forbidden, instant, page } from "./firestore";
import type { CircleAccess, MutationContext, PageInput } from "./firestore";
import { applyRange } from "./medications";

interface Range extends PageInput { from?: string; to?: string }

function appointment(id: string, record: DocumentData) {
  return {
    id, title: record.title, startsAt: instant(record.startsAt), endsAt: instant(record.endsAt),
    ...(record.location ? { location: record.location } : {}), state: record.state, updatedAt: instant(record.updatedAt),
  };
}

export function listAppointments(tx: Transaction, scope: CircleAccess, input: Range, now: Timestamp) {
  const ref = scope.ref.collection("appointments");
  const upcoming = input.cursor || input.from ? input : { ...input, from: instant(now) };
  // The implicit lower bound only applies to the first page. The cursor already points after that bound.
  const query = applyRange(ref.where("state", "==", "scheduled").orderBy("startsAt").orderBy(byId), "startsAt", upcoming);
  return page({
    tx, query, input, scope: ["appointments", scope.ref.id, input.from, input.to],
    reference: (id) => ref.doc(id), present: (doc) => appointment(doc.id, exists(doc)),
  });
}

export async function changeAppointment(
  context: MutationContext, scope: CircleAccess, id?: string, body?: ApiBody<"createAppointment">,
) {
  const { tx, uid, now } = context;
  const appointments = scope.ref.collection("appointments");
  const ref = id ? appointments.doc(id) : appointments.doc();
  const previous = id ? exists(await tx.get(ref)) : null;
  if (previous?.state === "cancelled") conflict("This appointment was cancelled.");
  let data: DocumentData;
  if (body) {
    const startsAt = Timestamp.fromDate(new Date(body.startsAt));
    const endsAt = Timestamp.fromDate(new Date(body.endsAt));
    if (endsAt.toMillis() <= now.toMillis()) conflict("Choose an appointment whose end is in the future.");
    data = {
      title: body.title, startsAt, endsAt, ...(body.location ? { location: body.location } : {}),
      state: "scheduled", reminderAt: Timestamp.fromMillis(Math.max(now.toMillis(), startsAt.toMillis() - hour)),
      reminderPending: startsAt.toMillis() > now.toMillis(),
      reminderVersion: (previous?.reminderVersion ?? 0) + 1,
      createdAt: previous?.createdAt ?? now, updatedAt: now,
    };
  } else {
    data = { ...previous, state: "cancelled", reminderPending: false, updatedAt: now };
  }
  tx.set(ref, data);
  audit(tx, scope.ref, uid, id ? body ? "appointment.updated" : "appointment.cancelled" : "appointment.created", ref.id, now);
  return appointment(ref.id, data);
}

function taskData(id: string, record: DocumentData) {
  return {
    id, doseId: record.doseId, assigneeUid: record.assigneeUid, ownerUid: record.ownerUid,
    state: record.state, openedAt: instant(record.openedAt), outcome: record.outcome,
    resolvedAt: record.resolvedAt ? instant(record.resolvedAt) : null, updatedAt: instant(record.updatedAt),
  };
}

export function listEscalations(tx: Transaction, scope: CircleAccess, input: PageInput) {
  const ref = scope.ref.collection("escalations");
  return page({
    tx, query: ref.orderBy("openedAt", "desc").orderBy(byId, "desc"), input,
    scope: ["escalations", scope.ref.id], reference: (id) => ref.doc(id),
    present: (doc) => taskData(doc.id, exists(doc)),
  });
}

export async function claimTask(context: MutationContext, scope: CircleAccess, id: string) {
  const { tx, uid, now } = context;
  if (scope.grant?.role !== "caregiver") forbidden();
  const ref = scope.ref.collection("escalations").doc(id);
  const record = exists(await tx.get(ref));
  if (record.state === "resolved") conflict("This task is already resolved.");
  const currentUid = record.state === "claimed" ? record.ownerUid : record.assigneeUid;
  const active = typeof currentUid === "string" && canRespond(await tx.get(scope.ref.collection("members").doc(currentUid)));
  if (active && record.state === "claimed") conflict("This task is already claimed.");
  if (active && currentUid !== uid) forbidden();
  const data = { ...record, ownerUid: uid, assigneeUid: active ? currentUid : null, state: "claimed", updatedAt: now };
  tx.set(ref, data);
  audit(tx, scope.ref, uid, "escalation.claimed", id, now);
  return taskData(id, data);
}

export async function resolveTask(
  context: MutationContext, scope: CircleAccess, id: string, body: ApiBody<"resolveEscalation">,
) {
  const { tx, uid, now } = context;
  if (scope.grant?.role !== "caregiver") forbidden();
  const ref = scope.ref.collection("escalations").doc(id);
  const record = exists(await tx.get(ref));
  if (record.ownerUid !== uid) forbidden();
  if (record.state !== "claimed") conflict("Claim the task before recording an outcome.");
  const data = { ...record, state: "resolved", outcome: body.outcome, resolvedAt: now, updatedAt: now };
  tx.set(ref, data);
  audit(tx, scope.ref, uid, "escalation.resolved", id, now);
  return taskData(id, data);
}

export async function getInsights(tx: Transaction, scope: CircleAccess, input: ApiQuery<"getInsights">) {
  const ref = scope.ref.collection("doseOccurrences");
  const counts = { scheduled: 0, patientReported: 0, verified: 0, needsReview: 0, missed: 0 };
  const keys = { scheduled: "scheduled", patient_reported: "patientReported", verified: "verified", needs_review: "needsReview", missed: "missed" } as const;
  const doses = await tx.get(applyRange(ref, "scheduledAt", input).select("state"));
  for (const dose of doses.docs) {
    const state = dose.get("state") as keyof typeof keys;
    if (Object.hasOwn(keys, state)) counts[keys[state]] += 1;
  }
  return { ...input, ...counts };
}

const auditData = (doc: DocumentSnapshot) => {
  const record = exists(doc);
  return { id: doc.id, actorUid: record.actorUid, action: record.action,
    resourceId: record.resourceId, createdAt: instant(record.createdAt) };
};

export function listAudit(tx: Transaction, scope: CircleAccess, input: PageInput) {
  const ref = scope.ref.collection("auditEvents");
  return page({
    tx, query: ref.orderBy("createdAt", "desc").orderBy(byId, "desc"), input,
    scope: ["audit", scope.ref.id], reference: (id) => ref.doc(id), present: auditData,
  });
}
