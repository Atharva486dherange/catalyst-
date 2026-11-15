import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
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

interface Actor { uid: string; email: string; password: string; token: string }

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
  return { uid: user.uid, email, password, token: idToken };
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

async function browserSignIn(page: Page, actor: Actor) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(actor.email);
  await page.getByLabel("Password").fill(actor.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test.describe("browser Care Circle", () => {
  test.skip(!process.env.SAATHI_TEST_UI, "Set SAATHI_TEST_UI to run the Chromium workflow.");

  test("patient and caregiver coordinate a dose follow-up through the UI", async ({ browser, request }) => {
    test.setTimeout(120_000);
    const env = emulators();
    const [patient, caregiver] = await Promise.all([account(env, "browser-patient"), account(env, "browser-caregiver")]);
    const patientPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const caregiverPage = await browser.newPage();
    try {
      await browserSignIn(patientPage, patient);
      await patientPage.getByLabel("Patient name").fill("Asha Demo");
      await patientPage.getByLabel("Time zone").fill("UTC");
      await patientPage.getByRole("button", { name: "Create circle" }).click();
      await expect(patientPage.getByRole("heading", { name: "My Day" })).toBeVisible();
      await patientPage.getByRole("button", { name: "Manage care" }).click();
      await patientPage.getByLabel("Email address").fill(caregiver.email);
      await patientPage.getByLabel("Claim and resolve tasks").check();
      await patientPage.getByRole("button", { name: "Queue invitation" }).click();
      await expect(patientPage.getByRole("status")).toContainText("Invitation queued");

      const owner = caller(request, patient);
      const circles = apiContracts.listCircles.response.parse(await (await owner.get("/circles")).json()).data.items;
      const circle = circles[0]!;
      const path = `/circles/${circle.id}`;
      const invitation = apiContracts.listInvitations.response.parse(await (await owner.get(`${path}/invitations`)).json()).data.items[0]!;
      await browserSignIn(caregiverPage, caregiver);
      await caregiverPage.getByLabel("Invitation code").fill(await invitationCode(env, invitation.id));
      await caregiverPage.getByRole("button", { name: "Join Care Circle" }).click();
      await expect(caregiverPage.getByRole("heading", { name: "Care Circle" })).toBeVisible();

      const now = Date.now();
      const midnightUtc = Math.floor(now / (24 * hour)) * 24 * hour;
      const scheduledAt = Timestamp.fromMillis(Math.max(midnightUtc, now - 5 * 60_000));
      const doses = env.db.collection("circles").doc(circle.id).collection("doseOccurrences");
      const mismatch = doses.doc();
      const help = doses.doc();
      const fixture = {
        medicationId: "browser-medication", scheduleId: "browser-schedule", scheduledAt,
        state: "scheduled", patientReport: null, verification: null,
        createdAt: Timestamp.fromMillis(now - hour), updatedAt: scheduledAt,
      };
      await Promise.all([
        mismatch.set({ ...fixture, medicationSnapshot: { ...medicine, name: "Dose for review" } }),
        help.set({ ...fixture, medicationSnapshot: { ...medicine, name: "Dose needing help" } }),
      ]);
      await patientPage.getByRole("button", { name: "My Day", exact: true }).click();
      await patientPage.getByRole("button", { name: "Refresh", exact: true }).click();
      const reviewCard = patientPage.getByRole("article").filter({ hasText: "Dose for review" });
      await reviewCard.getByRole("button", { name: "Report taken" }).click();
      await expect(reviewCard.getByRole("button", { name: "Submit dose report" })).toBeDisabled();
      await reviewCard.getByLabel("Amount taken").fill("2");
      await reviewCard.getByLabel("I confirm these details are correct.").check();
      await reviewCard.getByRole("button", { name: "Submit dose report" }).click();
      await expect(reviewCard.getByText("Needs review", { exact: true })).toBeVisible();

      const helpCard = patientPage.getByRole("article").filter({ hasText: "Dose needing help" });
      await helpCard.getByRole("button", { name: "Ask for help" }).click();
      await expect(helpCard.getByRole("status")).toContainText("A follow-up task is available");
      await caregiverPage.getByRole("button", { name: "Refresh", exact: true }).click();
      const task = caregiverPage.getByRole("article").filter({ hasText: "Dose needing help follow-up" });
      await task.getByRole("button", { name: "Claim task" }).click();
      await expect(task.getByText("Claimed", { exact: true })).toBeVisible();
      await task.getByLabel("Check-in outcome").selectOption("checked_in");
      await task.getByRole("button", { name: "Resolve task" }).click();
      await expect(task.getByText("Resolved", { exact: true })).toBeVisible();
      await caregiverPage.screenshot({ path: test.info().outputPath("caregiver-task.png") });
      await caregiverPage.getByLabel("Unresolved only").check();
      await expect(task).toHaveCount(0);
      await expect(caregiverPage.getByText("Dose for review follow-up")).toBeVisible();

      await patientPage.screenshot({ path: test.info().outputPath("patient-my-day.png") });
      await patientPage.getByRole("button", { name: "Care Circle", exact: true }).click();
      const patientTask = patientPage.getByRole("article").filter({ hasText: "Dose needing help follow-up" });
      await expect(patientTask.getByText("Resolved", { exact: true })).toBeVisible();
      const unchanged = apiContracts.getDose.response.parse(await (await owner.get(`${path}/doses/${help.id}`)).json()).data;
      expect(unchanged.state).toBe("needs_review");
      expect(unchanged.verifiedAt).toBeNull();
      await patientPage.getByRole("button", { name: "My Day", exact: true }).click();

      await patientPage.getByRole("button", { name: "Add appointment" }).click();
      await patientPage.getByLabel("Title", { exact: true }).fill("Synthetic clinic visit");
      await patientPage.getByLabel("Starts at").fill(new Date(now + hour).toISOString().slice(0, 19));
      await patientPage.getByLabel("Ends at").fill(new Date(now + 2 * hour).toISOString().slice(0, 19));
      await patientPage.getByRole("button", { name: "Save appointment", exact: true }).click();
      const visit = patientPage.locator(".appointment").filter({ hasText: "Synthetic clinic visit" });
      await visit.getByRole("button", { name: "Edit", exact: true }).click();
      await visit.getByLabel("Location (optional)").fill("Synthetic clinic room");
      await visit.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(visit.getByText("Synthetic clinic room")).toBeVisible();
      await visit.getByRole("button", { name: "Cancel appointment", exact: true }).click();
      await expect(visit).toHaveCount(0);

      await patientPage.getByRole("button", { name: "Upload prescription document" }).click();
      await patientPage.setInputFiles('input[name="file"]', {
        name: "prescription.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"),
      });
      await patientPage.getByLabel("I consent to AI-assisted prescription text extraction.").check();
      await patientPage.getByRole("button", { name: "Extract medicines with AI" }).click();
      await expect(patientPage.getByText("AI Extraction Unavailable")).toBeVisible();

      const extracted = env.db.collection("circles").doc(circle.id).collection("extractions").doc();
      const items = [{ name: null, amountText: null, scheduleText: null }];
      const updatedAt = Timestamp.now();
      await extracted.set({ state: "pending_review", items, reviewedItems: null, createdAt: updatedAt, updatedAt });
      // Simulate provider output while still saving the review through the emulator API.
      await patientPage.route(`**/api/v1${path}/prescription-extractions`, (route) => route.fulfill({
        status: 201,
        json: { data: { id: extracted.id, state: "pending_review", items, reviewedItems: null, updatedAt: updatedAt.toDate().toISOString() } },
      }), { times: 1 });
      await patientPage.getByRole("button", { name: "Extract medicines with AI" }).click();
      await expect(patientPage.getByText("Extracted amount: Unreadable")).toBeVisible();
      await expect(patientPage.getByLabel("Medicine name", { exact: true })).toHaveValue("");
      await expect(patientPage.getByLabel("Amount", { exact: true })).toHaveValue("");
      await expect(patientPage.getByLabel("Unit", { exact: true })).toHaveValue("");
      await patientPage.getByLabel("Medicine name", { exact: true }).fill("Reviewed sample medicine");
      await patientPage.getByLabel("Amount", { exact: true }).fill("2");
      await patientPage.getByLabel("Unit", { exact: true }).fill("tablet");
      await patientPage.getByRole("button", { name: "Save reviewed draft" }).click();
      await expect(patientPage.getByText("Prescription draft saved separately from active medication records.")).toBeVisible();
      expect((await extracted.get()).get("state")).toBe("reviewed");
      expect((await env.db.collection("circles").doc(circle.id).collection("medications").get()).size).toBe(0);

      expect(await patientPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    } finally {
      await Promise.all([patientPage.context().close(), caregiverPage.context().close()]);
    }
  });
});

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
  const openTasks = await helper.get(`${path}/escalations?status=unresolved`);
  expect(openTasks.status()).toBe(200);
  const openList = apiContracts.listEscalations.response.parse(await openTasks.json()).data;
  expect(openList.items.some((item) => item.id === second.id && item.state === "open")).toBe(true);

  expect((await helper.post(`${task}/claim`)).status()).toBe(200);
  const claimedTasks = await helper.get(`${path}/escalations?status=unresolved`);
  const claimedList = apiContracts.listEscalations.response.parse(await claimedTasks.json()).data;
  expect(claimedList.items.some((item) => item.id === second.id && item.state === "claimed")).toBe(true);

  expect((await helper.post(`${task}/resolve`, { outcome: "checked_in" })).status()).toBe(200);
  const remaining = apiContracts.listEscalations.response.parse(await (await helper.get(`${path}/escalations?status=unresolved`)).json()).data;
  expect(remaining.items.some((item) => item.id === second.id)).toBe(false);

  const resolvedOnly = await helper.get(`${path}/escalations?status=resolved`);
  const resolvedList = apiContracts.listEscalations.response.parse(await resolvedOnly.json()).data;
  expect(resolvedList.items.some((item) => item.id === second.id && item.state === "resolved")).toBe(true);

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

test("Scheduler expires invitations and removes pending email codes without email delivery", async () => {
  const { db } = emulators();
  const now = Timestamp.now();
  async function pendingInvitation(delivery: "ready" | "leased", expiresAt: ReturnType<typeof Timestamp.now>) {
    const invitation = db.collection("invitations").doc();
    const jobId = createHash("sha256").update(`invitation:${invitation.id}`).digest("base64url");
    const job = db.collection("notificationJobs").doc(jobId);
    await Promise.all([
      invitation.create({ state: "pending", expiresAt }),
      job.create({
        state: delivery, codeCiphertext: "synthetic-code",
        ...(delivery === "leased" ? { lease: "synthetic-lease" } : {}),
      }),
    ]);
    return { invitation, job };
  }
  const [queued, leased, fresh] = await Promise.all([
    pendingInvitation("ready", now),
    pendingInvitation("leased", now),
    pendingInvitation("ready", Timestamp.fromMillis(now.toMillis() + hour)),
  ]);

  await Promise.all([sweep(db, now), sweep(db, now)]);

  for (const { invitation, job } of [queued, leased]) {
    expect((await invitation.get()).get("state")).toBe("expired");
    const cancelled = await job.get();
    expect(cancelled.get("state")).toBe("cancelled");
    expect(cancelled.get("codeCiphertext")).toBeUndefined();
    expect(cancelled.get("lease")).toBeUndefined();
  }
  expect((await fresh.invitation.get()).get("state")).toBe("pending");
  expect((await fresh.job.get()).get("state")).toBe("ready");
  expect((await fresh.job.get()).get("codeCiphertext")).toBe("synthetic-code");
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
