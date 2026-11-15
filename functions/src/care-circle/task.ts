import type { DocumentReference, DocumentSnapshot, Timestamp, Transaction } from "firebase-admin/firestore";
import { stableId } from "../medications/recurrence";

export function canRespond(member: DocumentSnapshot) {
  return member.get("state") === "active" && member.get("role") === "caregiver" &&
    Array.isArray(member.get("permissions")) && member.get("permissions").includes("escalation:respond");
}

export async function currentAssignee(tx: Transaction, circle: DocumentReference, defaultUid: unknown) {
  if (typeof defaultUid !== "string") return null;
  return canRespond(await tx.get(circle.collection("members").doc(defaultUid))) ? defaultUid : null;
}

export function openTask(
  tx: Transaction, task: DocumentReference, assigneeUid: string | null,
  reason: "missed" | "needs_help" | "needs_review", now: Timestamp,
) {
  tx.create(task, {
    doseId: task.id, reason, assigneeUid, ownerUid: null, state: "open", openedAt: now,
    resolvedAt: null, outcome: null, updatedAt: now,
  });
  if (assigneeUid) {
    const id = stableId("escalation", task.path, assigneeUid);
    tx.create(task.firestore.collection("notificationJobs").doc(id), {
      kind: "escalation", circleId: task.parent.parent!.id, escalationId: task.id, recipientUid: assigneeUid,
      state: "ready", availableAt: now, createdAt: now, attempts: 0,
    });
  }
}
