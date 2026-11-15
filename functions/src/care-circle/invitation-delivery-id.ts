import { createHash } from "node:crypto";

export function invitationDeliveryId(invitationId: string) {
  return createHash("sha256").update(`invitation:${invitationId}`).digest("base64url");
}
