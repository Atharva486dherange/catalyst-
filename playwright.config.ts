import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

const port = Number(process.env.SAATHI_TEST_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;
const emulatorTests = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST);
if (emulatorTests) process.env.TEST_INVITATION_KEY ??= randomBytes(32).toString("base64");

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: emulatorTests ? "backend.spec.ts" : "health.spec.ts",
  timeout: 90_000,
  use: { baseURL },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: false,
    env: emulatorTests ? {
      FIREBASE_PROJECT_ID: "demo-saathi",
      INVITATION_ENCRYPTION_KEY: process.env.TEST_INVITATION_KEY!,
      GEMINI_ENABLE_PRESCRIPTION_EXTRACTION: "false",
    } : undefined,
  },
});
