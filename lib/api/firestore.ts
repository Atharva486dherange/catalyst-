import "server-only";
import { createHash } from "node:crypto";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import type {
  CollectionReference, DocumentData, DocumentReference, DocumentSnapshot, Firestore, Query, Transaction,
} from "firebase-admin/firestore";
import { consentGrantSchema, idSchema } from "@/shared/types/domain";
import type { ConsentGrant, Permission } from "@/shared/types/domain";
import { HttpError } from "./http";

export const digest = (value: string) => createHash("sha256").update(value).digest("base64url");
export const byId = FieldPath.documentId();

export function notFound(): never {
  throw new HttpError("NOT_FOUND", "The requested record was not found.");
}

export function conflict(message: string): never {
  throw new HttpError("CONFLICT", message);
}

export function forbidden(): never {
  throw new HttpError("FORBIDDEN", "Your current access does not allow this action.");
}

export function exists(snapshot: DocumentSnapshot): DocumentData {
  return snapshot.data() ?? notFound();
}

export function instant(value: Timestamp): string {
  return value.toDate().toISOString();
}

export interface CircleAccess {
  ref: DocumentReference;
  circle: DocumentData;
  patient: boolean;
  grant?: ConsentGrant;
}

export async function access(
  tx: Transaction, db: Firestore, circleId: string, uid: string, requirement: Permission | "patient",
): Promise<CircleAccess> {
  const ref = db.collection("circles").doc(circleId);
  const [circleDoc, memberDoc] = await Promise.all([tx.get(ref), tx.get(ref.collection("members").doc(uid))]);
  const circle = exists(circleDoc);
  if (circle.patientUid === uid) return { ref, circle, patient: true };
  const member = memberDoc.data();
  if (!member || member.state !== "active" || member.uid !== uid) notFound();
  const grant = consentGrantSchema.parse({ role: member.role, permissions: member.permissions });
  if (requirement === "patient" || !grant.permissions.includes(requirement)) forbidden();
  return { ref, circle, patient: false, grant };
}

export interface MutationContext {
  tx: Transaction;
  key: string;
  uid: string;
  operation: string;
  target: string[];
  body: unknown;
  now: Timestamp;
}

export async function once(
  context: MutationContext, receipts: CollectionReference, perform: () => Promise<unknown>,
): Promise<unknown> {
  const { tx, key, uid, operation, target, body, now } = context;
  const receipt = receipts.doc(digest(JSON.stringify([uid, operation, target, key])));
  const fingerprint = digest(JSON.stringify(body ?? null));
  const existing = (await tx.get(receipt)).data();
  if (existing && existing.expiresAt.toMillis() > now.toMillis()) {
    if (existing.fingerprint !== fingerprint) conflict("The idempotency key was already used for a different request.");
    return existing.data;
  }
  const data = await perform();
  tx.set(receipt, { fingerprint, data, expiresAt: Timestamp.fromMillis(now.toMillis() + 86_400_000) });
  return data;
}

export function audit(
  tx: Transaction, circle: DocumentReference, actorUid: string | null,
  action: string, resourceId: string, now: Timestamp,
): void {
  tx.create(circle.collection("auditEvents").doc(), { actorUid, action, resourceId, createdAt: now });
}

export interface PageInput { limit: number; cursor?: string }

export async function page<T>(options: {
  tx: Transaction;
  query: Query;
  input: PageInput;
  scope: readonly unknown[];
  reference: (id: string) => DocumentReference;
  itemId?: (doc: DocumentSnapshot) => string;
  present: (doc: DocumentSnapshot) => T | Promise<T>;
  permittedCursor?: (doc: DocumentSnapshot) => boolean;
}) {
  const { tx, input, scope, reference, present } = options;
  const binding = digest(JSON.stringify(scope));
  let query = options.query;
  if (input.cursor) {
    const [cursorBinding, id, extra] = input.cursor.split(".");
    if (cursorBinding !== binding || extra !== undefined || !idSchema.safeParse(id).success || !id) {
      throw new HttpError("INVALID_INPUT", "Use the cursor from the same list.");
    }
    const last = await tx.get(reference(id));
    if (!last.exists || options.permittedCursor?.(last) === false) throw new HttpError("INVALID_INPUT", "This cursor is no longer available.");
    query = query.startAfter(last);
  }
  const snapshot = await tx.get(query.limit(input.limit + 1));
  const selected = snapshot.docs.slice(0, input.limit);
  const last = selected.at(-1);
  const nextCursor = last && snapshot.size > input.limit
    ? `${binding}.${options.itemId ? options.itemId(last) : last.id}` : null;
  return { items: await Promise.all(selected.map(present)), nextCursor };
}

export const documentId = (doc: DocumentSnapshot) => doc.id;
