import "server-only";
import { createCipheriv, randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { ApiBody } from "@/shared/contracts/api";
import { consentGrantSchema } from "@/shared/types/domain";
import { access, audit, byId, conflict, digest, exists, instant, notFound, once, page } from "./firestore";
import type { CircleAccess, MutationContext, PageInput } from "./firestore";
import { HttpError } from "./http";

const circleData = (id: string, record: FirebaseFirestore.DocumentData) => ({
  id, displayName: record.displayName, timeZone: record.timeZone, updatedAt: instant(record.updatedAt),
});

export function getCircle(circle: CircleAccess) {
  return circleData(circle.ref.id, circle.circle);
}

export async function listCircles(tx: Transaction, db: Firestore, uid: string, query: PageInput) {
  const members = db.collectionGroup("members").where("uid", "==", uid).where("state", "==", "active").orderBy(byId);
  return page({
    tx, query: members, input: query, scope: ["circles", uid],
    reference: (id) => db.doc(`circles/${id}/members/${uid}`),
    itemId: (doc) => doc.ref.parent.parent!.id,
    present: async (doc) => {
      const ref = doc.ref.parent.parent!;
      const circle = exists(await tx.get(ref));
      const member = exists(doc);
      return {
        id: ref.id, displayName: circle.displayName, role: member.role,
        permissions: member.role === "patient" ? [] : grantFrom(member).permissions,
      };
    },
  });
}

export async function createCircle(
  context: MutationContext, db: Firestore, profile: ApiBody<"createCircle">,
) {
  const { tx, uid, now } = context;
  const user = db.collection("users").doc(uid);
  return once(context, user.collection("idempotencyKeys"), async () => {
    if ((await tx.get(user)).get("ownedCircleId")) conflict("This account already owns a care circle.");
    const ref = db.collection("circles").doc();
    const record = { ...profile, patientUid: uid, defaultCaregiverUid: null, createdAt: now, updatedAt: now };
    tx.create(ref, record);
    tx.set(user, { ownedCircleId: ref.id, createdAt: now, updatedAt: now }, { merge: true });
    tx.create(ref.collection("members").doc(uid), {
      uid, role: "patient", permissions: [], state: "active", createdAt: now, updatedAt: now,
    });
    audit(tx, ref, uid, "circle.created", ref.id, now);
    return circleData(ref.id, record);
  });
}

export function updateCircle(context: MutationContext, circle: CircleAccess, body: ApiBody<"updateCircle">) {
  const { tx, uid, now } = context;
  tx.update(circle.ref, { ...body, updatedAt: now });
  audit(tx, circle.ref, uid, "circle.updated", circle.ref.id, now);
  return circleData(circle.ref.id, { ...body, updatedAt: now });
}

function grantFrom(record: FirebaseFirestore.DocumentData) {
  return consentGrantSchema.parse({ role: record.role, permissions: record.permissions });
}

function invitation(id: string, record: FirebaseFirestore.DocumentData, now: Timestamp) {
  const state = record.state === "pending" && record.expiresAt.toMillis() <= now.toMillis() ? "expired" : record.state;
  return { id, email: record.email, state, expiresAt: instant(record.expiresAt) };
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function stopInvitationDelivery(tx: Transaction, db: Firestore, id: string, now: Timestamp) {
  const ref = db.collection("notificationJobs").doc(digest(`invitation:${id}`));
  const job = await tx.get(ref);
  if (job.exists && ["ready", "leased"].includes(job.get("state"))) {
    tx.update(ref, { state: "cancelled", codeCiphertext: FieldValue.delete(), lease: FieldValue.delete(), updatedAt: now });
  }
}

function encryptInvitation(code: string, invitationId: string) {
  const configured = process.env.INVITATION_ENCRYPTION_KEY;
  const key = configured ? Buffer.from(configured, "base64") : Buffer.alloc(0);
  if (key.length !== 32) throw new HttpError("UNAVAILABLE", "Invitation delivery is not configured.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(invitationId));
  const ciphertext = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function listInvitations(
  tx: Transaction, db: Firestore, circle: CircleAccess, query: PageInput, now: Timestamp,
) {
  const ref = db.collection("invitations");
  return page({
    tx, query: ref.where("circleId", "==", circle.ref.id).orderBy(byId), input: query,
    scope: ["invitations", circle.ref.id], reference: (id) => ref.doc(id),
    permittedCursor: (doc) => doc.get("circleId") === circle.ref.id,
    present: (doc) => invitation(doc.id, exists(doc), now),
  });
}

export async function createInvitation(
  context: MutationContext, db: Firestore, circle: CircleAccess, body: ApiBody<"createInvitation">,
) {
  const { tx, uid, now } = context;
  const email = normalizeEmail(body.email);
  const recipient = circle.ref.collection("invitationRecipients").doc(digest(email));
  const previous = (await tx.get(recipient)).get("invitationId");
  if (typeof previous === "string") {
    const prior = (await tx.get(db.collection("invitations").doc(previous))).data();
    if (prior && invitation(previous, prior, now).state === "pending") conflict("This address already has a pending invitation.");
  }
  const quota = circle.ref.collection("invitationQuotas").doc(now.toDate().toISOString().slice(0, 10));
  const used = (await tx.get(quota)).get("count") ?? 0;
  if (used >= 15) throw new HttpError("RATE_LIMITED", "This circle has reached its daily invitation limit.");
  const code = randomBytes(32).toString("base64url");
  const id = digest(code);
  const record = {
    circleId: circle.ref.id, email, ...body.consent,
    consentedByUid: uid, consentedAt: now, state: "pending",
    expiresAt: Timestamp.fromMillis(now.toMillis() + 72 * 3_600_000), createdAt: now, updatedAt: now,
  };
  const codeCiphertext = encryptInvitation(code, id);
  tx.create(db.collection("invitations").doc(id), record);
  tx.set(recipient, { invitationId: id, updatedAt: now });
  tx.set(quota, { count: used + 1, expiresAt: Timestamp.fromMillis(now.toMillis() + 48 * 3_600_000) });
  tx.create(db.collection("notificationJobs").doc(digest(`invitation:${id}`)), {
    kind: "invitation", invitationId: id, codeCiphertext, state: "ready",
    availableAt: now, createdAt: now, attempts: 0,
  });
  audit(tx, circle.ref, uid, "invitation.created", id, now);
  return invitation(id, record, now);
}

export async function revokeInvitation(
  context: MutationContext, db: Firestore, circle: CircleAccess, invitationId: string,
) {
  const { tx, uid, now } = context;
  const ref = db.collection("invitations").doc(invitationId);
  const record = exists(await tx.get(ref));
  if (record.circleId !== circle.ref.id) notFound();
  if (invitation(invitationId, record, now).state !== "pending") conflict("Only a pending invitation can be revoked.");
  await stopInvitationDelivery(tx, db, invitationId, now);
  tx.update(ref, { state: "revoked", updatedAt: now });
  audit(tx, circle.ref, uid, "invitation.revoked", invitationId, now);
  return invitation(invitationId, { ...record, state: "revoked" }, now);
}

export async function acceptInvitation(
  context: MutationContext, db: Firestore, identity: DecodedIdToken, body: ApiBody<"acceptInvitation">,
) {
  const { tx, uid, now } = context;
  if (!identity.email_verified || !identity.email) notFound();
  const id = digest(body.code);
  const ref = db.collection("invitations").doc(id);
  const record = exists(await tx.get(ref));
  if (record.email !== normalizeEmail(identity.email)) notFound();
  const circle = db.collection("circles").doc(record.circleId);
  const member = circle.collection("members").doc(uid);
  const [circleDoc, memberDoc] = await Promise.all([tx.get(circle), tx.get(member)]);
  const profile = exists(circleDoc);
  const previous = memberDoc.data();
  if (profile.patientUid === uid) notFound();
  const replay = record.state === "accepted" && record.acceptedByUid === uid && previous?.state === "active" &&
    previous.invitationId === id;
  if (!replay && invitation(id, record, now).state !== "pending") notFound();
  return once(context, db.collection("users").doc(uid).collection("idempotencyKeys"), async () => {
    if (replay) notFound();
    if (previous?.state === "active") conflict("This account already has access to the circle.");
    const consent = grantFrom(record);
    await stopInvitationDelivery(tx, db, id, now);
    tx.set(member, {
      uid, ...consent, state: "active", email: record.email, invitationId: id, consentedAt: record.consentedAt,
      consentedByUid: record.consentedByUid, createdAt: previous?.createdAt ?? now, updatedAt: now,
    });
    tx.update(ref, { state: "accepted", acceptedByUid: uid, updatedAt: now });
    audit(tx, circle, uid, "membership.granted", uid, now);
    return { id: circle.id, displayName: profile.displayName, ...consent };
  });
}

const membership = (doc: DocumentSnapshot) => {
  const record = exists(doc);
  return { uid: doc.id, email: record.email, consent: grantFrom(record), state: record.state, updatedAt: instant(record.updatedAt) };
};

export function listMemberships(tx: Transaction, circle: CircleAccess, query: PageInput) {
  const ref = circle.ref.collection("members");
  return page({
    tx, query: ref.where("role", "in", ["family", "caregiver"]).orderBy(byId), input: query,
    scope: ["members", circle.ref.id], reference: (id) => ref.doc(id), present: membership,
  });
}

export async function revokeMembership(
  context: MutationContext, db: Firestore, circle: CircleAccess, memberUid: string,
) {
  const { tx, uid, now } = context;
  if (memberUid === uid) notFound();
  const member = circle.ref.collection("members").doc(memberUid);
  const record = exists(await tx.get(member));
  if (record.state !== "active") conflict("Only an active grant can be revoked.");
  const invitationId = (await tx.get(circle.ref.collection("invitationRecipients").doc(digest(record.email)))).get("invitationId");
  const pending = typeof invitationId === "string" ? await tx.get(db.collection("invitations").doc(invitationId)) : null;
  const tasks = circle.ref.collection("escalations");
  const [owned, assigned] = await Promise.all([
    tx.get(tasks.where("ownerUid", "==", memberUid).where("state", "==", "claimed").limit(90)),
    tx.get(tasks.where("assigneeUid", "==", memberUid).where("state", "==", "open").limit(90)),
  ]);
  if (pending?.get("state") === "pending") await stopInvitationDelivery(tx, db, pending.id, now);
  // A worker also reconciles additional stale tasks. The revoked membership denies access immediately.
  for (const task of [...owned.docs, ...assigned.docs]) {
    tx.update(task.ref, { ownerUid: null, assigneeUid: null, state: "open", updatedAt: now });
  }
  if (pending?.get("state") === "pending") tx.update(pending.ref, { state: "revoked", updatedAt: now });
  tx.update(member, { state: "revoked", updatedAt: now });
  if (owned.size === 90 || assigned.size === 90) {
    tx.set(db.collection("membershipRecovery").doc(digest(JSON.stringify([circle.ref.id, memberUid]))), {
      circleId: circle.ref.id, uid: memberUid, createdAt: now,
    });
  }
  if (circle.circle.defaultCaregiverUid === memberUid) {
    tx.update(circle.ref, { defaultCaregiverUid: null, updatedAt: now });
  }
  audit(tx, circle.ref, uid, "membership.revoked", memberUid, now);
  return { uid: memberUid, email: record.email, consent: grantFrom(record), state: "revoked", updatedAt: instant(now) };
}

export async function setAssignee(
  context: MutationContext, db: Firestore, circle: CircleAccess, body: ApiBody<"setEscalationAssignee">,
) {
  const { tx, uid, now } = context;
  if (body.caregiverUid) {
    const caregiver = await access(tx, db, circle.ref.id, body.caregiverUid, "escalation:respond");
    if (caregiver.grant?.role !== "caregiver") conflict("Choose an eligible caregiver.");
  }
  tx.update(circle.ref, { defaultCaregiverUid: body.caregiverUid, updatedAt: now });
  audit(tx, circle.ref, uid, "circle.assignee_updated", circle.ref.id, now);
  return body;
}
