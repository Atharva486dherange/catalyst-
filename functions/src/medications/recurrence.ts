import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import type { DocumentReference, Timestamp, Transaction } from "firebase-admin/firestore";

export const hour = 3_600_000;
const horizonDays = 13;

export interface SchedulePlan {
  medicationId: string;
  localTimes: string[];
  timeZone: string;
  startDate: string;
  endDate?: string;
}

export interface MedicationSnapshot {
  name: string;
  prescribedAmount: { value: string; unit: string };
}

export function localDay(at: Timestamp, zone: string) {
  return Temporal.Instant.fromEpochMilliseconds(at.toMillis()).toZonedDateTimeISO(zone).toPlainDate();
}

export function scheduleTime(date: Temporal.PlainDate, time: string, zone: string) {
  const local = date.toPlainDateTime(time);
  const zoned = local.toZonedDateTime(zone, { disambiguation: "earlier" });
  return local.equals(zoned.toPlainDateTime()) ? zoned.epochMilliseconds : null;
}

export const stableId = (namespace: string, ...parts: string[]) =>
  createHash("sha256").update(JSON.stringify([namespace, ...parts])).digest("base64url");

export function extendOccurrences(
  tx: Transaction, circle: DocumentReference, scheduleId: string, plan: SchedulePlan,
  medication: MedicationSnapshot, now: Timestamp, makeTimestamp: (milliseconds: number) => Timestamp,
  through?: string, activatedAt = now,
) {
  const today = localDay(now, plan.timeZone);
  const horizon = today.add({ days: horizonDays });
  const start = Temporal.PlainDate.from(plan.startDate);
  const end = plan.endDate && plan.endDate < horizon.toString()
    ? Temporal.PlainDate.from(plan.endDate) : horizon;
  let date = through ? Temporal.PlainDate.from(through).add({ days: 1 }) : start;
  const activationDay = localDay(activatedAt, plan.timeZone);
  if (!through && Temporal.PlainDate.compare(date, activationDay) < 0) date = activationDay;
  // A bounded catch-up prevents Firestore transaction size limits after a pause.
  const batchEnd = date.add({ days: horizonDays });
  const until = Temporal.PlainDate.compare(batchEnd, end) < 0 ? batchEnd : end;
  if (Temporal.PlainDate.compare(date, until) > 0) return { through: through ?? null, needsReview: false };
  let needsReview = false;

  for (; Temporal.PlainDate.compare(date, until) <= 0; date = date.add({ days: 1 })) {
    for (const time of plan.localTimes) {
      const milliseconds = scheduleTime(date, time, plan.timeZone);
      if (milliseconds === null) {
        needsReview = true;
        const id = stableId("nonexistent-time", scheduleId, date.toString(), time);
        tx.create(circle.collection("scheduleExceptions").doc(id), {
          scheduleId, localDate: date.toString(), localTime: time, timeZone: plan.timeZone,
          state: "needs_review", createdAt: now,
        });
        continue;
      }
      if (!through && milliseconds < activatedAt.toMillis()) continue;
      const id = stableId("dose", scheduleId, String(milliseconds));
      tx.create(circle.collection("doseOccurrences").doc(id), {
        medicationId: plan.medicationId, scheduleId, medicationSnapshot: medication,
        scheduledAt: makeTimestamp(milliseconds),
        reviewAfter: makeTimestamp(milliseconds + hour),
        reminderAt: makeTimestamp(milliseconds), reminderPending: true,
        state: "scheduled", patientReport: null, verification: null, cancelledAt: null, scheduleActivatedAt: activatedAt,
        createdAt: now, updatedAt: now,
      });
    }
  }
  return { through: until.toString(), needsReview };
}
