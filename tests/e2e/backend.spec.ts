import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { apiContracts } from "../../shared/contracts/api";
import { hour } from "../../functions/src/medications/recurrence";
import { sweep } from "../../functions/src/reminders/sweep";
import { deliverNotifications } from "../../functions/src/notifications/deliver";

// Firestore timestamps and field transforms must come from the same SDK instance as the worker client.
const requireWorker = createRequire(resolve("functions/package.json"));
const { initializeApp } = requireWorker("firebase-admin/app") as typeof import("firebase-admin/app");
const { getAuth } = requireWorker("firebase-admin/auth") as typeof import("firebase-admin/auth");
const { getFirestore, Timestamp } = requireWorker("firebase-admin/firestore") as typeof import("firebase-admin/firestore");

function emulators() {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const dbHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (authHost !== "127.0.0.1:9099" || dbHost !== "127.0.0.1:8080") {
    throw new Error("Run npm run test:backend against the configured local emulators.");
  }
  const app = initializeApp({ projectId: "demo-saathi" }, randomUUID());
  return { auth: getAuth(app), db: getFirestore(app), authHost };
}

interface Actor { uid: string; email: string; token: string }

async function account(env: ReturnType<typeof emulators>, name: string): Promise<Actor> {
  const email = `${name}-${randomUUID()}@example.test`;
  const password = randomUUID();
  const user = await env.auth.createUser({ email, password, emailVerified: true });
  const response = await fetch(`http://${env.authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  expect(response.ok).toBe(true);
  const { idToken } = await response.json();
  expect(typeof idToken).toBe("string");
  return { uid: user.uid, email, token: idToken };
}

function caller(request: APIRequestContext, actor: Actor) {
  const auth = { Authorization: `Bearer ${actor.token}` };
  return {
    get: (path: string) => request.get(`/api/v1${path}`, { headers: auth }),
    post: (path: string, data?: unknown, key = randomUUID()) =>
      request.post(`/api/v1${path}`, { headers: { ...auth, "Idempotency-Key": key }, data }),
    put: (path: string, data: unknown) =>
      request.put(`/api/v1${path}`, { headers: { ...auth, "Idempotency-Key": randomUUID() }, data }),
  };
}

async function invitationCode(env: ReturnType<typeof emulators>, id: string) {
  const jobId = createHash("sha256").update(`invitation:${id}`).digest("base64url");
  const payload = (await env.db.collection("notificationJobs").doc(jobId).get()).get("codeCiphertext") as string;
  const [iv, tag, encrypted] = payload.split(".");
  const key = process.env.TEST_INVITATION_KEY;
  if (!iv || !tag || !encrypted || !key) throw new Error("Missing encrypted test invitation.");
  const cipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), Buffer.from(iv, "base64url"));
  cipher.setAAD(Buffer.from(id));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([cipher.update(Buffer.from(encrypted, "base64url")), cipher.final()]).toString("utf8");
}

const medicine = { name: "Synthetic example", prescribedAmount: { value: "1.0", unit: "unit" } };

test("consent gates access and dose evidence stays distinct from verification", async ({ request }) => {
  const env = emulators();
  const [patient, caregiver, stranger] = await Promise.all([
    account(env, "patient"), account(env, "caregiver"), account(env, "stranger"),
  ]);
  const owner = caller(request, patient);
  const helper = caller(request, caregiver);
  const independent = caller(request, stranger);

  const key = randomUUID();
  const profile = { displayName: "Synthetic patient", timeZone: "UTC" };
  const created = await owner.post("/circles", profile, key);
  expect(created.status()).toBe(201);
  const { data: circle } = apiContracts.createCircle.response.parse(await created.json());
  const path = `/circles/${circle.id}`;
  const replay = await owner.post("/circles", profile, key);
  expect(await replay.json()).toEqual({ data: circle });
  expect((await owner.post("/circles", { ...profile, displayName: "Changed" }, key)).status()).toBe(409);
  expect((await request.get(`/api/v1${path}`)).status()).toBe(401);
  expect((await helper.get(path)).status()).toBe(404);
  expect((await independent.get(path)).status()).toBe(404);

  const invitation = await owner.post(`${path}/invitations`, {
    email: caregiver.email,
    consent: { role: "caregiver", permissions: ["care:read", "dose:verify", "escalation:respond"] },
  });
  expect(invitation.status()).toBe(201);
  const { data: invite } = apiContracts.createInvitation.response.parse(await invitation.json());
  const code = await invitationCode(env, invite.id);
  expect((await independent.post("/invitations/accept", { code })).status()).toBe(404);
  expect((await helper.post("/invitations/accept", { code })).status()).toBe(200);
  expect((await helper.post("/invitations/accept", { code })).status()).toBe(404);
  const circleList = await helper.get("/circles");
  expect(circleList.status()).toBe(200);
  const listed = apiContracts.listCircles.response.parse(await circleList.json()).data;
  expect(listed.items[0]?.id).toBe(circle.id);
  expect((await helper.get(path)).status()).toBe(200);
  expect((await helper.put(path, profile)).status()).toBe(403);
  expect((await owner.put(`${path}/escalation-assignee`, { caregiverUid: caregiver.uid })).status()).toBe(200);

  const medResponse = await owner.post(`${path}/medications`, medicine);
  expect(medResponse.status()).toBe(201);
  const med = apiContracts.createMedication.response.parse(await medResponse.json()).data;
  const nextDay = new Date(Date.now() + 24 * hour).toISOString().slice(0, 10);
  const schedule = await owner.post(`${path}/schedules`, {
    medicationId: med.id, localTimes: ["08:00", "20:00"], timeZone: "UTC", startDate: nextDay, endDate: nextDay,
  });
  expect(schedule.status()).toBe(201);
  const plan = apiContracts.createSchedule.response.parse(await schedule.json()).data;
  const listedDoses = await owner.get(`${path}/doses`);
  expect(apiContracts.listDoses.response.parse(await listedDoses.json()).data.items).toHaveLength(2);
  expect((await owner.put(`${path}/medications/${med.id}`, medicine)).status()).toBe(409);
  expect((await owner.post(`${path}/schedules/${plan.id}/end`)).status()).toBe(200);
  const cancelledDoses = await owner.get(`${path}/doses`);
  expect(apiContracts.listDoses.response.parse(await cancelledDoses.json()).data.items.every((dose) => dose.state === "cancelled")).toBe(true);

  const now = Date.now();
  const scheduledAt = Timestamp.fromMillis(now - 5 * 60_000);
  const occurrences = env.db.collection("circles").doc(circle.id).collection("doseOccurrences");
  const due = occurrences.doc();
  const second = occurrences.doc();
  const data = {
    medicationId: med.id, scheduleId: plan.id, scheduledAt, medicationSnapshot: medicine, state: "scheduled",
    patientReport: null, verification: null, createdAt: Timestamp.fromMillis(now - 10 * 60_000), updatedAt: scheduledAt,
  };
  await Promise.all([due.set(data), second.set(data)]);
  const evidence = {
    medicationId: med.id, medicationName: medicine.name, amount: { value: "1", unit: "unit" },
    scheduledAt: scheduledAt.toDate().toISOString(), administeredAt: new Date(now - 2 * 60_000).toISOString(),
  };
  const reportPath = `${path}/doses/${due.id}/reports`;
  const results = await Promise.all([
    owner.post(reportPath, { kind: "patient_report", evidence }),
    owner.post(reportPath, { kind: "patient_report", evidence }),
  ]);
  expect(results.map((result) => result.status()).sort()).toEqual([200, 409]);
  const report = results.find((result) => result.ok());
  if (!report) throw new Error("Missing successful patient report");
  const reported = apiContracts.reportDose.response.parse(await report.json()).data;
  expect(reported.state).toBe("patient_reported");
  expect(reported.verifiedAt).toBeNull();
  expect((await owner.post(reportPath, { kind: "caregiver_verification", evidence })).status()).toBe(403);
  const verifiedResponse = await helper.post(reportPath, { kind: "caregiver_verification", evidence });
  const verified = apiContracts.reportDose.response.parse(await verifiedResponse.json()).data;
  expect(verified.state).toBe("verified");
  expect(verified.verifiedAt).not.toBeNull();
  expect(verified.patientReportedAt).toBe(reported.patientReportedAt);

  const discrepancy = await owner.post(`${path}/doses/${second.id}/reports`, {
    kind: "patient_report", evidence: { ...evidence, amount: { value: "2", unit: "unit" } },
  });
  const review = apiContracts.reportDose.response.parse(await discrepancy.json()).data;
  expect(review.state).toBe("needs_review");
  expect(review.patientReportedAt).toBeNull();
  const task = `${path}/escalations/${second.id}`;
  expect((await helper.post(`${task}/claim`)).status()).toBe(200);
  expect((await helper.post(`${task}/resolve`, { outcome: "checked_in" })).status()).toBe(200);
  const preserved = await owner.get(`${path}/doses/${second.id}`);
  expect(apiContracts.getDose.response.parse(await preserved.json()).data.state).toBe("needs_review");

  const appointment = await owner.post(`${path}/appointments`, {
    title: "Synthetic appointment", startsAt: new Date(now + hour).toISOString(), endsAt: new Date(now + 2 * hour).toISOString(),
  });
  expect(appointment.status()).toBe(201);
  const event = apiContracts.createAppointment.response.parse(await appointment.json()).data;
  expect((await helper.get(`${path}/appointments`)).status()).toBe(200);
  expect((await owner.post(`${path}/appointments/${event.id}/cancel`)).status()).toBe(200);

  const upload = await request.post(`/api/v1${path}/prescription-extractions`, {
    headers: { Authorization: `Bearer ${patient.token}`, "Idempotency-Key": randomUUID() },
    multipart: {
      consent: "true", file: { name: "synthetic.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n%%EOF") },
    },
  });
  expect(upload.status()).toBe(503);
  const extraction = env.db.collection("circles").doc(circle.id).collection("extractions").doc();
  await extraction.set({ state: "pending_review", items: [], reviewedItems: null, updatedAt: scheduledAt });
  const reviewed = await owner.post(`${path}/prescription-extractions/${extraction.id}/review`, { items: [medicine] });
  expect(apiContracts.reviewExtraction.response.parse(await reviewed.json()).data.state).toBe("reviewed");

  expect((await owner.post(`${path}/members/${caregiver.uid}/revoke`)).status()).toBe(200);
  expect((await helper.get(`${path}/doses`)).status()).toBe(404);
  expect((await owner.get(`${path}/audit-events`)).status()).toBe(200);
});

test("overlapping Scheduler sweeps create one task and one email job", async () => {
  const { db } = emulators();
  const circle = db.collection("circles").doc();
  const now = Timestamp.now();
  const due = circle.collection("doseOccurrences").doc();
  await Promise.all([
    circle.create({ patientUid: "synthetic-patient", defaultCaregiverUid: "synthetic-caregiver" }),
    circle.collection("members").doc("synthetic-caregiver").create({
      role: "caregiver", state: "active", permissions: ["care:read", "escalation:respond"],
    }),
    due.create({ state: "scheduled", reminderPending: false, reviewAfter: now, updatedAt: now }),
  ]);
  await Promise.all([sweep(db, now), sweep(db, now)]);
  expect((await due.get()).get("state")).toBe("missed");
  expect((await circle.collection("escalations").get()).size).toBe(1);
  expect((await db.collection("notificationJobs").where("circleId", "==", circle.id).get()).size).toBe(1);
  expect((await circle.collection("auditEvents").get()).size).toBe(1);
});

test("the email worker retries a generic message with the same provider key", async () => {
  const env = emulators();
  const patient = await account(env, "reminder");
  const circle = env.db.collection("circles").doc();
  const dose = circle.collection("doseOccurrences").doc();
  const job = env.db.collection("notificationJobs").doc();
  const now = Timestamp.now();
  await Promise.all([
    circle.create({ patientUid: patient.uid }),
    dose.create({ state: "scheduled", reviewAfter: Timestamp.fromMillis(now.toMillis() + hour) }),
    job.create({
      kind: "dose", circleId: circle.id, resourceId: dose.id, recipientUid: patient.uid,
      state: "ready", availableAt: now, attempts: 0,
    }),
  ]);

  const settings = {
    ENABLE_OUTBOUND_EMAIL: "true",
    RESEND_API_KEY: "emulator-synthetic",
    RESEND_FROM_EMAIL: "noreply@example.test",
    APP_ORIGIN: "https://saathi.example.test",
    INVITATION_ENCRYPTION_KEY: process.env.TEST_INVITATION_KEY!,
  };
  const previous = Object.fromEntries(Object.keys(settings).map((name) => [name, process.env[name]]));
  const calls: { key: string | null; body: unknown }[] = [];
  const transport: typeof fetch = async (_input, init) => {
    const key = new Headers(init?.headers).get("idempotency-key");
    const body = JSON.parse(String(init?.body));
    calls.push({ key, body });
    return new Response(null, { status: calls.length === 1 ? 503 : 200 });
  };
  try {
    Object.assign(process.env, settings);
    await deliverNotifications(env.db, env.auth, Timestamp.now(), transport);
    expect((await job.get()).get("state")).toBe("ready");
    await job.update({ availableAt: Timestamp.now() });
    await deliverNotifications(env.db, env.auth, Timestamp.now(), transport);
    expect((await job.get()).get("state")).toBe("delivered");
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
  expect(calls[0]).toEqual({
    key: job.id,
    body: {
      from: settings.RESEND_FROM_EMAIL, to: [patient.email], subject: "You have a SAATHI update",
      text: "Sign in to SAATHI at https://saathi.example.test to view your update.",
    },
  });
});
