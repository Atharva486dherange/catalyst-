import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";

export function getBrowserAuth() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const emulator = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

  if (!projectId || (!emulator && (!apiKey || projectId.startsWith("demo-")))) return null;
  if (emulator && (!projectId.startsWith("demo-") ||
    !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(emulator) ||
    !["127.0.0.1", "localhost"].includes(window.location.hostname))) return null;

  const existing = getApps().find(({ name }) => name === "saathi-browser");
  if (existing) return getAuth(existing);

  const app = initializeApp({
    apiKey: apiKey || "demo-saathi",
    projectId,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || undefined,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || undefined,
  }, "saathi-browser");
  const auth = getAuth(app);
  if (emulator) connectAuthEmulator(auth, emulator);
  return auth;
}
