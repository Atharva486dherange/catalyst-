import { createDecipheriv, randomUUID } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { DocumentData, DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { canRespond } from "../care-circle/task";
import { hour } from "../medications/recurrence";

interface Settings { key: string; from: string; origin: string; invitationKey: string }
type Job = { data: DocumentData; lease: string };
type DeliveryState = "delivered" | "cancelled" | "needs_review" | "ready";

function settings(): Settings | null {
  const { ENABLE_OUTBOUND_EMAIL, RESEND_API_KEY, RESEND_FROM_EMAIL, APP_ORIGIN, INVITATION_ENCRYPTION_KEY } = process.env;
  if (ENABLE_OUTBOUND_EMAIL !== "true" || !RESEND_API_KEY || !RESEND_FROM_EMAIL || !APP_ORIGIN ||
    !INVITATION_ENCRYPTION_KEY || Buffer.from(INVITATION_ENCRYPTION_KEY, "base64").length !== 32) return null;
  try {
    const url = new URL(APP_ORIGIN);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return { key: RESEND_API_KEY, from: RESEND_FROM_EMAIL, origin: url.origin, invitationKey: INVITATION_ENCRYPTION_KEY };
  } catch {
    return null;
  }
}

function invitationCode(payload: string, id: string, key: string) {
  const [iv, tag, data] = payload.split(".");
  if (!iv || !tag || !data) throw new Error("Invalid invitation payload");
  const cipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), Buffer.from(iv, "base64url"));
  cipher.setAAD(Buffer.from(id));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([cipher.update(Buffer.from(data, "base64url")), cipher.final()]).toString("utf8");
}

async function leased(db: Firestore, ref: DocumentReference, now: Timestamp): Promise<Job | null> {
  return db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data || !["ready", "leased"].includes(data.state) || data.availableAt.toMillis() > now.toMillis()) return null;
    const firstAttemptAt = data.firstAttemptAt ?? now;
    if (now.toMillis() - firstAttemptAt.toMillis() >= 20 * hour) {
      tx.update(ref, { state: "needs_review", codeCiphertext: FieldValue.delete(), updatedAt: now });
      return null;
    }
    const lease = randomUUID();
    const attempts = (data.attempts ?? 0) + 1;
    tx.update(ref, { state: "leased", lease, firstAttemptAt, attempts,
      availableAt: Timestamp.fromMillis(now.toMillis() + 5 * 60_000), updatedAt: now });
    return { lease, data: { ...data, attempts } };
  });
}

async function recipient(tx: Transaction, db: Firestore, job: DocumentData, now: Timestamp) {
  if (job.kind === "invitation") {
    const invitation = await tx.get(db.collection("invitations").doc(job.invitationId));
    if (invitation.get("state") !== "pending" || invitation.get("expiresAt").toMillis() <= now.toMillis()) return null;
    return { email: invitation.get("email") as string };
  }
  const circle = db.collection("circles").doc(job.circleId);
  if (job.kind === "escalation") {
    const [member, task] = await Promise.all([
      tx.get(circle.collection("members").doc(job.recipientUid)),
      tx.get(circle.collection("escalations").doc(job.escalationId)),
    ]);
    return canRespond(member) && task.get("state") === "open" && task.get("assigneeUid") === job.recipientUid
      ? { uid: job.recipientUid as string } : null;
  }
  if (job.kind !== "dose" && job.kind !== "appointment") return null;
  const [profile, resource] = await Promise.all([
    tx.get(circle),
    tx.get(circle.collection(job.kind === "dose" ? "doseOccurrences" : "appointments").doc(job.resourceId)),
  ]);
  if (profile.get("patientUid") !== job.recipientUid || resource.get("state") !== "scheduled") return null;
  if (job.kind === "dose" && resource.get("reviewAfter").toMillis() <= now.toMillis()) return null;
  if (job.kind === "appointment" && (resource.get("reminderVersion") !== job.version ||
    resource.get("startsAt").toMillis() <= now.toMillis())) return null;
  return { uid: job.recipientUid as string };
}

async function complete(db: Firestore, ref: DocumentReference, item: Job, status: DeliveryState, now: Timestamp) {
  await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.get("lease") !== item.lease || current.get("state") !== "leased") return;
    const update: DocumentData = { state: status, lease: FieldValue.delete(), updatedAt: now };
    if (status === "ready") {
      const delay = Math.min(2 ** item.data.attempts, 60) * 60_000;
      update.availableAt = Timestamp.fromMillis(now.toMillis() + delay);
    } else {
      update.codeCiphertext = FieldValue.delete();
    }
    tx.update(ref, update);
  });
}

async function send(config: Settings, job: DocumentData, id: string, email: string, request: typeof fetch): Promise<DeliveryState> {
  let text: string;
  let subject: string;
  if (job.kind === "invitation") {
    subject = "You have a SAATHI invitation";
    try {
      const code = invitationCode(job.codeCiphertext, job.invitationId, config.invitationKey);
      text = `Sign in to SAATHI at ${config.origin} and enter this single-use code: ${code}`;
    } catch {
      return "needs_review";
    }
  } else {
    subject = "You have a SAATHI update";
    text = `Sign in to SAATHI at ${config.origin} to view your update.`;
  }

  try {
    const response = await request("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json", "Idempotency-Key": id },
      body: JSON.stringify({ from: config.from, to: [email], subject, text }),
    });
    if (response.ok) return "delivered";
    if ([408, 409, 429].includes(response.status) || response.status >= 500) return "ready";
    return "needs_review";
  } catch {
    return "ready";
  }
}

export async function deliverNotifications(db: Firestore, auth: Auth, now = Timestamp.now(), request = fetch) {
  const config = settings();
  if (!config) return;
  const jobs = await db.collection("notificationJobs").where("state", "in", ["ready", "leased"])
    .where("availableAt", "<=", now).orderBy("availableAt").limit(10).get();
  for (const job of jobs.docs) {
    const currentTime = Timestamp.now();
    const item = await leased(db, job.ref, currentTime);
    if (!item) continue;
    const target = await db.runTransaction((tx) => recipient(tx, db, item.data, currentTime), { readOnly: true });
    let email = target?.email;
    if (target?.uid) {
      const user = await auth.getUser(target.uid).catch((error: { code?: string }) => {
        if (error.code === "auth/user-not-found") return null;
        throw error;
      });
      if (user?.emailVerified && !user.disabled) email = user.email;
    }
    const result = email ? await send(config, item.data, job.id, email, request) : "cancelled";
    await complete(db, job.ref, item, result, Timestamp.now());
  }
}
