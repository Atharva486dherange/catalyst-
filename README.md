# SAATHI

SAATHI is a voice-first elderly care coordination project for PromptWars × Catalyst. The mobile-first frontend is developed separately. This repository contains the backend, shared API contract, and emulator tests.

## Local development

Use Node.js 22 LTS, npm, and Java 21 for the Firestore emulator. Use `npm.cmd` in PowerShell when execution policy blocks `npm.ps1`.

```sh
npm ci
npm --prefix functions ci
```

Copy `.env.example` to `.env.local`. Keep the demo project IDs and emulator hosts. For local invitation creation, use the following command to generate a new development key and put it in `INVITATION_ENCRYPTION_KEY`. Keep outbound email and Gemini extraction disabled during local interactive development unless you deliberately configure a test integration.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
npm run emulators
```

In a second terminal, run `npm run dev`. The health check is available at [the local health endpoint](http://localhost:3000/api/v1/health). The [Emulator UI](http://127.0.0.1:4000) is available while Firebase runs. Use Firebase Authentication's local emulator for sign-in. Protected routes expect the user's Firebase ID token as described in the API contract.

`npm run emulators:functions` also builds and discovers both scheduled workers. Use the integration suites to exercise their logic against Firestore on demand.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run test:rules
npm run test:backend
npm --prefix functions run build
npm run build
```

Stop existing Firestore/Auth emulators before running the scripts that start them. Playwright uses HTTP requests in these suites and requires no browser binaries. Run the Playwright suites and Next.js build sequentially. The backend suite generates synthetic users and records and disables Gemini.

## Hosted Firebase setup

1. Create or select the team Firebase project and enable billing for App Hosting, Cloud Functions, and Cloud Scheduler. Enable the intended Firebase Authentication provider, register a web app, and provision the default Firestore database.
2. Use `npx firebase login` and deploy `npx firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID`. Wait for indexes to build. The rules deny every client request and the server uses Firebase Admin with Application Default Credentials. Assign the runtime identity the Firestore and Firebase Auth IAM permissions required by the authorized server workflows.
3. Connect Firebase App Hosting to the shared repository root. Configure the real Firebase web app values at frontend build time. Set the deployed server project ID and omit emulator variables.
4. Generate an invitation encryption key. Store it in Secret Manager and expose the same key to App Hosting at runtime and to the Functions delivery worker under `INVITATION_ENCRYPTION_KEY`. Configure the Functions `RESEND_API_KEY` secret, set `RESEND_FROM_EMAIL` to a verified sender and `APP_ORIGIN` to the HTTPS app origin, then set `ENABLE_OUTBOUND_EMAIL=true` in the Functions environment when ready to send. Run `npx firebase deploy --only functions --project YOUR_PROJECT_ID` to provision both scheduled functions and their Cloud Scheduler jobs. Align deployment regions with the database and application architecture during provisioning.
5. For the prescription demo, set the `GEMINI_API_KEY` App Hosting runtime secret, `GEMINI_MODEL` to an available model supporting structured document extraction, and `GEMINI_ENABLE_PRESCRIPTION_EXTRACTION=true`. Use synthetic prescriptions for the demo. Enable real uploads after agreeing on the deployment's provider data handling and retention.

Official documentation: [Emulator Suite](https://firebase.google.com/docs/emulator-suite/install_and_configure), [App Hosting configuration](https://firebase.google.com/docs/app-hosting/configure), [Firestore indexes](https://firebase.google.com/docs/firestore/query-data/indexing), [scheduled functions](https://firebase.google.com/docs/functions/schedule-functions), [Gemini content generation](https://ai.google.dev/api/generate-content), and [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Handoff

- [Product brief](docs/PRODUCT.md)
- [Architecture and Firestore model](docs/ARCHITECTURE.md)
- [HTTP API contract](docs/API_CONTRACT.md)
- [Build status](docs/BUILD_STATUS.md)
