import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { deliverNotifications } from "./notifications/deliver";
import { sweep } from "./reminders/sweep";

initializeApp();

export const sweepCare = onSchedule({
  schedule: "every 5 minutes", timeZone: "UTC", retryCount: 2, timeoutSeconds: 180,
}, async () => {
  await sweep(getFirestore());
});

export const sendCareEmails = onSchedule({
  schedule: "every 5 minutes", timeZone: "UTC", retryCount: 2, timeoutSeconds: 180,
  secrets: [defineSecret("RESEND_API_KEY"), defineSecret("INVITATION_ENCRYPTION_KEY")],
}, async () => {
  await deliverNotifications(getFirestore(), getAuth());
});
