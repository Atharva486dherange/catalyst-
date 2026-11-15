import { Timestamp } from "firebase-admin/firestore";
import type { DocumentReference, Firestore, QueryDocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { currentAssignee, openTask } from "../care-circle/task";
import { extendOccurrences, hour, localDay, stableId } from "../medications/recurrence";
import type { MedicationSnapshot, SchedulePlan } from "../medications/recurrence";

function writeAudit(tx: Transaction, circle: DocumentReference, action: string, resourceId: string, now: Timestamp) {
  tx.create(circle.collection("auditEvents").doc(), { action, resourceId, actorUid: null, createdAt: now });
}

async function extend(db: Firestore, item: QueryDocumentSnapshot, now: Timestamp) {
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(item.ref)).data();
    if (!current || current.state !== "active" || current.extendAfter.toMillis() > now.toMillis()) return;
    const circle = item.ref.parent.parent!;
    const plan = current as SchedulePlan;
    const snapshot = current.medicationSnapshot as MedicationSnapshot;
    const med = circle.collection("medications").doc(plan.medicationId);
    const medicine = await tx.get(med);
    if (medicine.get("activeScheduleId") !== item.id) return;

    const result = extendOccurrences(tx, circle, item.id, plan, snapshot, now, Timestamp.fromMillis,
      current.materializedThrough ?? undefined, current.createdAt);
    const { through } = result;
    const needsReview = Boolean(current.needsReview || result.needsReview);
    const elapsed = plan.endDate && localDay(now, plan.timeZone).toString() > plan.endDate;
    if (elapsed && through === plan.endDate) {
      tx.update(item.ref, { state: "ended", materializedThrough: through, needsReview, updatedAt: now });
      tx.update(med, { activeScheduleId: null, updatedAt: now });
      writeAudit(tx, circle, "schedule.ended", item.id, now);
      return;
    }
    const delay = through !== current.materializedThrough ? 15 * 60_000 : 12 * hour;
    tx.update(item.ref, { materializedThrough: through, needsReview, extendAfter: Timestamp.fromMillis(now.toMillis() + delay),
      ...(result.needsReview ? { updatedAt: now } : {}) });
  });
}

async function flagMissed(db: Firestore, item: QueryDocumentSnapshot, now: Timestamp) {
  await db.runTransaction(async (tx) => {
    const record = (await tx.get(item.ref)).data();
    if (!record || record.state !== "scheduled" || record.reviewAfter.toMillis() > now.toMillis()) return;
    const circle = item.ref.parent.parent!;
    const task = circle.collection("escalations").doc(item.id);
    const [existing, profile] = await Promise.all([tx.get(task), tx.get(circle)]);
    if (!profile.exists) return;
    if (!existing.exists) {
      const assignee = await currentAssignee(tx, circle, profile.get("defaultCaregiverUid"));
      openTask(tx, task, assignee, "missed", now);
    }
    tx.update(item.ref, { state: "missed", reminderPending: false, updatedAt: now });
    writeAudit(tx, circle, "dose.missed", item.id, now);
  });
}

async function prepareReminder(db: Firestore, item: QueryDocumentSnapshot, kind: "dose" | "appointment", now: Timestamp) {
  await db.runTransaction(async (tx) => {
    const record = (await tx.get(item.ref)).data();
    if (!record || !record.reminderPending || record.state !== "scheduled" || record.reminderAt.toMillis() > now.toMillis()) return;
    const circle = item.ref.parent.parent!;
    const patient = (await tx.get(circle)).get("patientUid");
    if (typeof patient !== "string") return;
    const stillRelevant = kind === "dose" ? record.reviewAfter.toMillis() > now.toMillis() : record.startsAt.toMillis() > now.toMillis();
    const version = kind === "appointment" ? record.reminderVersion : 0;
    if (stillRelevant) {
      tx.create(db.collection("notificationJobs").doc(stableId(kind, item.ref.path, String(version))), {
        kind, circleId: circle.id, resourceId: item.id, version, recipientUid: patient,
        state: "ready", availableAt: now, createdAt: now, attempts: 0,
      });
    }
    tx.update(item.ref, { reminderPending: false });
  });
}

async function recoverRevocations(db: Firestore, now: Timestamp) {
  const jobs = await db.collection("membershipRecovery").orderBy("createdAt").limit(30).get();
  for (const job of jobs.docs) {
    await db.runTransaction(async (tx) => {
      const data = (await tx.get(job.ref)).data();
      if (!data) return;
      const circle = db.collection("circles").doc(data.circleId);
      const membership = await tx.get(circle.collection("members").doc(data.uid));
      if (membership.get("state") === "active") {
        tx.delete(job.ref);
        return;
      }
      const tasks = circle.collection("escalations");
      const [owned, assigned] = await Promise.all([
        tx.get(tasks.where("ownerUid", "==", data.uid).where("state", "==", "claimed").limit(100)),
        tx.get(tasks.where("assigneeUid", "==", data.uid).where("state", "==", "open").limit(100)),
      ]);
      for (const task of [...owned.docs, ...assigned.docs]) {
        tx.update(task.ref, { state: "open", ownerUid: null, assigneeUid: null, updatedAt: now });
      }
      if (owned.size < 100 && assigned.size < 100) tx.delete(job.ref);
    });
  }
}

export async function sweep(db: Firestore, now = Timestamp.now()) {
  const schedules = await db.collectionGroup("schedules").where("state", "==", "active")
    .where("extendAfter", "<=", now).orderBy("extendAfter").limit(100).get();
  for (const item of schedules.docs) await extend(db, item, now);

  const missed = await db.collectionGroup("doseOccurrences").where("state", "==", "scheduled")
    .where("reviewAfter", "<=", now).orderBy("reviewAfter").limit(120).get();
  for (const item of missed.docs) await flagMissed(db, item, now);

  for (const [collection, kind] of [["doseOccurrences", "dose"], ["appointments", "appointment"]] as const) {
    const items = await db.collectionGroup(collection).where("reminderPending", "==", true)
      .where("reminderAt", "<=", now).orderBy("reminderAt").limit(120).get();
    for (const item of items.docs) await prepareReminder(db, item, kind, now);
  }
  await recoverRevocations(db, now);
}
