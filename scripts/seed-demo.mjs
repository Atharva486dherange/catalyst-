import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const projectId = "demo-saathi";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const app = initializeApp({ projectId }, "saathi-demo-seed");
const auth = getAuth(app);
const db = getFirestore(app);
const timeZone = "Asia/Kolkata";
const now = Temporal.Now.zonedDateTimeISO(timeZone);
const current = Timestamp.fromMillis(now.epochMilliseconds);
const scheduledAt = Timestamp.fromMillis(Math.max(now.startOfDay().epochMilliseconds, now.epochMilliseconds - 600_000));
const createdAt = Timestamp.fromMillis(scheduledAt.toMillis() - 900_000);
const suffix = randomUUID().slice(0, 8);

async function createAccount(role) {
  const email = `${role}+${suffix}@example.test`;
  const password = randomUUID().slice(0, 18);
  const user = await auth.createUser({ email, password, emailVerified: true });
  return { uid: user.uid, email, password };
}

try {
  const [patient, caregiver] = await Promise.all([createAccount("patient"), createAccount("caregiver")]);
  const circle = db.collection("circles").doc();
  const batch = db.batch();
  batch.create(circle, {
    patientUid: patient.uid, displayName: "Asha Demo", timeZone, defaultCaregiverUid: caregiver.uid,
    createdAt, updatedAt: current,
  });
  batch.create(db.collection("users").doc(patient.uid), { ownedCircleId: circle.id, createdAt, updatedAt: current });
  batch.create(circle.collection("members").doc(patient.uid), {
    uid: patient.uid, role: "patient", permissions: [], state: "active", createdAt, updatedAt: current,
  });
  batch.create(circle.collection("members").doc(caregiver.uid), {
    uid: caregiver.uid, email: caregiver.email, role: "caregiver", state: "active",
    permissions: ["care:read", "dose:verify", "escalation:respond"], consentedAt: createdAt,
    consentedByUid: patient.uid, createdAt, updatedAt: current,
  });

  for (const name of ["Morning sample", "Follow-up sample"]) {
    const medication = circle.collection("medications").doc();
    const snapshot = { name, prescribedAmount: { value: "1", unit: "tablet" } };
    batch.create(medication, { ...snapshot, state: "active", activeScheduleId: null, createdAt, updatedAt: current });
    batch.create(circle.collection("doseOccurrences").doc(), {
      medicationId: medication.id, scheduleId: `demo-${medication.id}`, medicationSnapshot: snapshot,
      scheduledAt, reviewAfter: Timestamp.fromMillis(current.toMillis() + 3_600_000),
      reminderPending: false, state: "scheduled", patientReport: null, verification: null, createdAt, updatedAt: current,
    });
  }
  batch.create(circle.collection("appointments").doc(), {
    title: "Sample follow-up visit", startsAt: Timestamp.fromMillis(current.toMillis() + 86_400_000),
    endsAt: Timestamp.fromMillis(current.toMillis() + 88_200_000), state: "scheduled",
    reminderPending: false, createdAt, updatedAt: current,
  });
  await batch.commit();
  console.log("Synthetic accounts in the local Firebase emulator");
  console.table([
    { role: "patient", email: patient.email, password: patient.password },
    { role: "caregiver", email: caregiver.email, password: caregiver.password },
  ]);
} catch {
  console.error("Could not seed the demo. Start npm run emulators first.");
  process.exitCode = 1;
} finally {
  await db.terminate();
  await deleteApp(app);
}
