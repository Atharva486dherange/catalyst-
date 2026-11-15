import "server-only";
import { randomUUID } from "node:crypto";
import type { DecodedIdToken } from "firebase-admin/auth";
import { z } from "zod";
import { apiErrorSchema, idempotencyKeySchema } from "@/shared/contracts/api";
import type { ApiError, ApiErrorCode } from "@/shared/contracts/api";
import { idSchema } from "@/shared/types/domain";
import { getAdminAuth } from "@/lib/firebase/admin";

const statuses: Record<ApiErrorCode, number> = {
  INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  CONFLICT: 409, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429, INTERNAL: 500, UNAVAILABLE: 503,
};

type FieldError = NonNullable<ApiError["error"]["fields"]>[number];

export class HttpError extends Error {
  constructor(public readonly code: ApiErrorCode, message: string, public readonly fields?: FieldError[]) {
    super(message);
  }
}

export function input<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => ({
      path: issue.path.join("."), message: "Invalid value",
    }));
    throw new HttpError("INVALID_INPUT", "Check the request fields.", fields);
  }
  return result.data;
}

export async function readBytes(request: Request, maximum: number) {
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > maximum) {
    throw new HttpError("PAYLOAD_TOO_LARGE", "The request body is too large.");
  }
  const stream = request.body?.getReader();
  if (!stream) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await stream.read();
      if (chunk.done) break;
      total += chunk.value.length;
      if (total > maximum) {
        await stream.cancel().catch(() => undefined);
        throw new HttpError("PAYLOAD_TOO_LARGE", "The request body is too large.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    stream.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function jsonBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new HttpError("UNSUPPORTED_MEDIA_TYPE", "Use application/json.");
  }
  const bytes = await readBytes(request, 32_768);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError("INVALID_INPUT", "The request body must be valid JSON.");
  }
}

export function readQuery(request: Request) {
  const search = new URL(request.url).searchParams;
  const result = Object.create(null) as Record<string, string>;
  for (const [name, value] of search) {
    if (Object.hasOwn(result, name)) throw new HttpError("INVALID_INPUT", "Query parameters must be unique.");
    result[name] = value;
  }
  return result;
}

export const mutationKey = (request: Request) => input(idempotencyKeySchema, request.headers.get("idempotency-key"));

export async function authenticate(request: Request): Promise<DecodedIdToken> {
  const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]{1,8192})$/i)?.[1];
  if (!token) throw new HttpError("UNAUTHENTICATED", "Sign in to continue.");
  const auth = getAdminAuth();
  try {
    const identity = await auth.verifyIdToken(token, true);
    if (!idSchema.safeParse(identity.uid).success) throw new HttpError("UNAUTHENTICATED", "Sign in to continue.");
    return identity;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === "string" && [
      "auth/argument-error", "auth/invalid-id-token", "auth/id-token-expired", "auth/id-token-revoked",
      "auth/user-disabled", "auth/user-not-found",
    ].includes(code)) throw new HttpError("UNAUTHENTICATED", "Sign in to continue.");
    throw error;
  }
}

export function answer(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function failure(error: unknown, operation?: string) {
  const requestId = randomUUID();
  const failure = error instanceof HttpError ? error : new HttpError("INTERNAL", "The request could not be completed.");
  if (!(error instanceof HttpError)) {
    console.error("saathi_request_failed", { requestId, operation });
  }
  const body = apiErrorSchema.parse({
    error: { code: failure.code, message: failure.message, requestId, fields: failure.fields },
  });
  return answer(body, statuses[failure.code]);
}
