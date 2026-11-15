import { FieldValue } from "firebase-admin/firestore";
import type { Firestore, Timestamp } from "firebase-admin/firestore";
import { invitationDeliveryId } from "./invitation-delivery-id";

export async function expireInvitations(db: Firestore, now: Timestamp) {
  const expired = await db.collection("invitations").where("state", "==", "pending")
    .where("expiresAt", "<=", now).orderBy("expiresAt").limit(100).get();

  for (const invitation of expired.docs) {
    await db.runTransaction(async (tx) => {
      const current = await tx.get(invitation.ref);
      if (current.get("state") !== "pending" || current.get("expiresAt").toMillis() > now.toMillis()) return;

      const delivery = db.collection("notificationJobs").doc(invitationDeliveryId(invitation.id));
      const job = await tx.get(delivery);
      tx.update(invitation.ref, { state: "expired", updatedAt: now });
      if (["ready", "leased"].includes(job.get("state"))) {
        tx.update(delivery, {
          state: "cancelled", codeCiphertext: FieldValue.delete(), lease: FieldValue.delete(), updatedAt: now,
        });
      }
    });
  }
}
