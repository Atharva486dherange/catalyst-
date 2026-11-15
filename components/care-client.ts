"use client";

import { FirebaseError } from "firebase/app";
import type { User } from "firebase/auth";
import { useRef, useState } from "react";
import type { ZodType } from "zod";
import { apiErrorSchema } from "@/shared/contracts/api";

class RequestError extends Error {}

export function messageFor(error: unknown) {
  if (error instanceof RequestError) return error.message;
  if (error instanceof FirebaseError) {
    if (error.code === "auth/weak-password") return "Choose a password with at least six characters.";
    if (error.code === "auth/email-already-in-use") return "This email already has an account. Sign in to continue.";
    if (error.code === "auth/network-request-failed") return "Could not reach sign-in. Check your connection and retry.";
    if (error.code === "auth/too-many-requests") return "Too many attempts. Wait a moment and try again.";
    return "Sign-in could not be completed. Check your account and try again.";
  }
  return "Could not connect to Saathi. Check your connection and try again.";
}

type Mutation = { method: "POST"; key: string; body?: unknown } | { method: "PUT"; key: string; body: unknown };

export async function careRequest<T>(user: User, path: string, schema: ZodType<{ data: T }>, mutation?: Mutation): Promise<T> {
  const headers = new Headers({ Authorization: `Bearer ${await user.getIdToken()}` });
  if (mutation) headers.set("Idempotency-Key", mutation.key);
  if (mutation?.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/v1${path}`, {
    method: mutation?.method ?? "GET",
    headers,
    body: mutation?.body === undefined ? undefined : JSON.stringify(mutation.body),
    cache: "no-store",
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(value);
    throw new RequestError(parsed.success ? parsed.data.error.message : "The request could not be completed.");
  }
  const result = schema.safeParse(value);
  if (!result.success) throw new RequestError("Saathi received an unexpected response. Please refresh and try again.");
  return result.data.data;
}

export async function careList<T>(
  user: User, path: string, schema: ZodType<{ data: { items: T[]; nextCursor: string | null } }>,
): Promise<T[]> {
  const [pathname, search] = path.split("?");
  const query = new URLSearchParams(search);
  query.set("limit", "50");
  const items: T[] = [];
  for (;;) {
    const data = await careRequest(user, `${pathname}?${query}`, schema);
    items.push(...data.items);
    if (!data.nextCursor) return items;
    query.set("cursor", data.nextCursor);
  }
}

export function useCareMutation(user: User, onSaved?: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const retry = useRef(new Map<string, string>());

  async function run<T>(path: string, schema: ZodType<{ data: T }>, body?: unknown, method: "POST" | "PUT" = "POST") {
    if (busy.current) return undefined;
    busy.current = true;
    const fingerprint = JSON.stringify([method, path, body]);
    const key = retry.current.get(fingerprint) ?? crypto.randomUUID();
    retry.current.set(fingerprint, key);
    setPending(true);
    setError("");
    try {
      const data = await careRequest(user, path, schema, method === "POST" ? { method, key, body } : { method, key, body });
      retry.current.delete(fingerprint);
      onSaved?.();
      return data;
    } catch (error) {
      setError(messageFor(error));
      return undefined;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return { run, pending, error };
}
