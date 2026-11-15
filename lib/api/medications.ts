import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import type { DocumentData, DocumentSnapshot, Query, Transaction } from "firebase-admin/firestore";
import type { ApiBody } from "@/shared/contracts/api";
import type { DoseAction } from "@/shared/types/domain";
import { extendOccurrences, localDay } from "@/functions/src/medications/recurrence";
import { currentAssignee, openTask } from "@/functions/src/care-circle/task";
import { audit, byId, conflict, exists, forbidden, instant, page } from "./firestore";
import type { CircleAccess, MutationContext, PageInput } from "./firestore";

interface TimePage extends PageInput { from?: string; to?: string }

const medication = (doc: DocumentSnapshot) => {
  const record = exists(doc);
  return {
    id: doc.id, name: record.name, prescribedAmount: record.prescribedAmount,
    state: record.state, updatedAt: instant(record.updatedAt),
  };
};

const schedule = (doc: DocumentSnapshot) => scheduleData(doc.id, exists(doc));

function scheduleData(id: string, record: DocumentData) {
  return {
    id, medicationId: record.medicationId, localTimes: record.localTimes, timeZone: record.timeZone,
    startDate: record.startDate, ...(record.endDate ? { endDate: record.endDate } : {}),
    state: record.state, ...(record.needsReview ? { needsReview: true } : {}), updatedAt: instant(record.updatedAt),
  };
}

export function doseData(id: string, record: DocumentData) {
  return {
    id, medicationId: record.medicationId, scheduleId: record.scheduleId,
    scheduledAt: instant(record.scheduledAt), medicationSnapshot: record.medicationSnapshot, state: record.state,
    patientReportedAt: record.patientReport ? instant(record.patientReport.recordedAt) : null,
    verifiedAt: record.verification ? instant(record.verification.recordedAt) : null,
    updatedAt: instant(record.updatedAt),
  };
}

export function listMedications(tx: Transaction, scope: CircleAccess, input: PageInput) {
  const ref = scope.ref.collection("medications");
  return page({
    tx, query: ref.orderBy(byId), input, scope: ["medications", scope.ref.id],
    reference: (id) => ref.doc(id), present: medication,
  });
}

export async function changeMedication(
  context: MutationContext, scope: CircleAccess, id?: string, profile?: ApiBody<"createMedication">,
) {
  const { tx, uid, now } = context;
  const medications = scope.ref.collection("medications");
  const ref = id ? medications.doc(id) : medications.doc();
  const old = id ? exists(await tx.get(ref)) : null;
  if (old?.state === "archived") conflict("This medication is archived.");
  if (old?.activeScheduleId) conflict("End the active schedule before changing this medication.");
  const state = profile ? "active" : "archived";
  const details = profile ?? { name: old?.name, prescribedAmount: old?.prescribedAmount };
  tx.set(ref, {
    ...details, state, activeScheduleId: null, createdAt: old?.createdAt ?? now, updatedAt: now,
  });
  audit(tx, scope.ref, uid, id ? profile ? "medication.updated" : "medication.archived" : "medication.created", ref.id, now);
  return { id: ref.id, ...details, state, updatedAt: instant(now) };
}

export function listSchedules(tx: Transaction, scope: CircleAccess, input: PageInput) {
  const ref = scope.ref.collection("schedules");
  return page({
    tx, query: ref.orderBy(byId), input, scope: ["schedules", scope.ref.id],
    reference: (id) => ref.doc(id), present: schedule,
  });
}

export async function createSchedule(context: MutationContext, scope: CircleAccess, plan: ApiBody<"createSchedule">) {
  const { tx, uid, now } = context;
  const today = localDay(now, plan.timeZone);
  if (plan.endDate && plan.endDate < today.toString()) conflict("Use a schedule with a current or future end date.");
  const ref = scope.ref.collection("schedules").doc();
  const med = scope.ref.collection("medications").doc(plan.medicationId);
  const record = exists(await tx.get(med));
  if (record.state !== "active") conflict("Choose an active medication.");
  if (record.activeScheduleId) conflict("End the existing schedule before creating a replacement.");
  const { name, prescribedAmount } = record;
  const snapshot = { name, prescribedAmount };
  const recurrence = extendOccurrences(tx, scope.ref, ref.id, plan, snapshot, now, Timestamp.fromMillis);
  const data = {
    medicationId: plan.medicationId, localTimes: plan.localTimes, timeZone: plan.timeZone,
    startDate: plan.startDate, ...(plan.endDate ? { endDate: plan.endDate } : {}),
    medicationSnapshot: snapshot, state: "active", materializedThrough: recurrence.through, needsReview: recurrence.needsReview,
    extendAfter: Timestamp.fromMillis(now.toMillis() + 24 * 3_600_000), createdAt: now, updatedAt: now,
  };
  tx.create(ref, data);
  tx.update(med, { activeScheduleId: ref.id, updatedAt: now });
  audit(tx, scope.ref, uid, "schedule.created", ref.id, now);
  return scheduleData(ref.id, data);
}

export async function endSchedule(context: MutationContext, scope: CircleAccess, id: string) {
  const { tx, uid, now } = context;
  const ref = scope.ref.collection("schedules").doc(id);
  const record = exists(await tx.get(ref));
  if (record.state !== "active") conflict("This schedule has ended.");
  const med = scope.ref.collection("medications").doc(record.medicationId);
  const [medicationDoc, occurrences] = await Promise.all([
    tx.get(med),
    tx.get(scope.ref.collection("doseOccurrences").where("scheduleId", "==", id)
      .where("scheduledAt", ">", now).where("state", "==", "scheduled")),
  ]);
  tx.update(ref, { state: "ended", updatedAt: now });
  if (medicationDoc.get("activeScheduleId") === id) tx.update(med, { activeScheduleId: null, updatedAt: now });
  for (const occurrence of occurrences.docs) {
    tx.update(occurrence.ref, { state: "cancelled", cancelledAt: now, reminderPending: false, updatedAt: now });
  }
  audit(tx, scope.ref, uid, "schedule.ended", id, now);
  return scheduleData(id, { ...record, state: "ended", updatedAt: now });
}

export function applyRange(query: Query, field: string, input: { from?: string; to?: string }) {
  if (input.from) query = query.where(field, ">=", Timestamp.fromDate(new Date(input.from)));
  if (input.to) query = query.where(field, "<", Timestamp.fromDate(new Date(input.to)));
  return query;
}

export function listDoses(tx: Transaction, scope: CircleAccess, input: TimePage) {
  const ref = scope.ref.collection("doseOccurrences");
  return page({
    tx, query: applyRange(ref.orderBy("scheduledAt").orderBy(byId), "scheduledAt", input),
    input, scope: ["doses", scope.ref.id, input.from, input.to], reference: (id) => ref.doc(id),
    present: (doc) => doseData(doc.id, exists(doc)),
  });
}

export async function getDose(tx: Transaction, scope: CircleAccess, id: string) {
  return doseData(id, exists(await tx.get(scope.ref.collection("doseOccurrences").doc(id))));
}

export function assertDoseActor(scope: CircleAccess, action: DoseAction) {
  if (scope.patient) {
    if (action.kind === "caregiver_verification") forbidden();
    return;
  }
  if ((action.kind !== "caregiver_verification" && action.kind !== "uncertain") ||
    !scope.grant?.permissions.includes("dose:verify")) forbidden();
}

export async function reportDose(context: MutationContext, scope: CircleAccess, id: string, action: DoseAction) {
  const { tx, uid, now } = context;
  const ref = scope.ref.collection("doseOccurrences").doc(id);
  const record = exists(await tx.get(ref));
  if (record.state === "cancelled") conflict("This occurrence was cancelled.");
  const evidence = "evidence" in action ? action.evidence : null;
  if (action.kind === "patient_report" && record.patientReport) conflict("A patient report already exists.");
  if (action.kind === "caregiver_verification" && record.verification) conflict("An independent verification already exists.");
  if (action.kind === "needs_help" && record.state === "verified") conflict("This occurrence is already verified.");

  const matches = evidence !== null && evidence.medicationId === record.medicationId &&
    evidence.medicationName === record.medicationSnapshot.name &&
    evidence.amount.unit === record.medicationSnapshot.prescribedAmount.unit &&
    Number(evidence.amount.value) === Number(record.medicationSnapshot.prescribedAmount.value) &&
    evidence.scheduledAt === instant(record.scheduledAt) && record.scheduledAt.toMillis() <= now.toMillis() &&
    Date.parse(evidence.administeredAt) >= (record.scheduleActivatedAt ?? record.createdAt).toMillis() && Date.parse(evidence.administeredAt) <= now.toMillis();

  const evidenceRecord = evidence && { ...evidence, recordedAt: now, actorUid: uid };
  let update: DocumentData;
  if (matches && evidenceRecord) {
    update = action.kind === "patient_report"
      ? { state: record.state === "needs_review" ? "needs_review" : record.verification ? "verified" : "patient_reported", patientReport: evidenceRecord }
      : { state: "verified", verification: evidenceRecord };
  } else {
    const task = scope.ref.collection("escalations").doc(id);
    const existing = await tx.get(task);
    if (!existing.exists) {
      const assignee = await currentAssignee(tx, scope.ref, scope.circle.defaultCaregiverUid);
      openTask(tx, task, assignee, action.kind === "needs_help" ? "needs_help" : "needs_review", now);
    }
    update = { state: "needs_review", lastReview: {
      reason: evidence ? "discrepancy" : action.kind, recordedAt: now, actorUid: uid,
      ...("note" in action && action.note ? { note: action.note } : {}),
    } };
  }
  tx.update(ref, { ...update, updatedAt: now, reminderPending: false });
  audit(tx, scope.ref, uid, `dose.${update.state}`, id, now);
  return doseData(id, { ...record, ...update, updatedAt: now });
}
