# 🌿 SAATHI
### Care That Stays Close, Even When Family Lives Far Away.

**Medication coordination with read-aloud guidance and caregiver follow-up**

*Built for PromptWars × Catalyst — Elderly Care & Medication Management Challenge*

---

## 🎯 The Problem

Elderly individuals face compounding challenges managing chronic medications:
- **Polypharmacy & Confusion**: Multiple prescriptions, varying dosages, and confusing pill shapes/colors.
- **Visual & Cognitive Barriers**: Small printed labels, complex app menus, and declining memory.
- **Family Distance Anxiety**: Adult children living in different cities constantly worry (*"Did Papa take his morning BP medicine?"*).
- **Broken Reminder Systems**: Existing apps only ring alarms; when an elder ignores or dismisses a reminder, **nobody follows up**.

> **Our Mission:** Better elderly care isn't about sending more buzzer reminders. It's about making sure someone is there when help is needed.

---

## What works in the app

| Workflow | Current behavior |
| --- | --- |
| Patient and caregiver accounts | Firebase sign-in, patient profile creation, scoped invitations, and access revocation. |
| My Day | Time-zone-aware dose records, appointment creation, editing and cancellation, read-aloud prompts, larger text, and explicit dose confirmation. |
| Care Circle | A help request or discrepancy opens a follow-up task. An eligible caregiver can claim and resolve it. Task resolution preserves dose evidence. |
| Medicines and schedules | Patients can add a medicine and set a daily schedule. The API also supports editing, ending schedules, and archiving. |
| Prescription intelligence | Patients can upload a prescription with consent and review the draft when Gemini is configured. Unreadable amounts stay blank for the patient to check. Reviewed drafts do not modify medication records. |

Hosted Firebase provisioning and live Resend and Gemini verification are pending. Camera pill recognition, multilingual speech input, doctor chat, visit summaries, stock, and trend charts are roadmap items.

## Local demo

1. Follow the local quickstart below to start Firebase Auth and Firestore and the Next.js dev server.
2. In a third terminal, run `npm run demo:seed`. It prints two synthetic accounts and adds two due doses to the local emulators.
3. Open [Saathi](http://localhost:3000). Sign in as the patient. Report one dose and use **Ask for help** on the other.
4. Open an incognito window and sign in as the caregiver. Claim the task, choose an outcome, and resolve it.
5. In the patient window, open **Care Circle** and refresh. The task shows **Resolved**. The dose remains **Needs review** until separately verified.

[Open the sample preview](http://localhost:3000/saathi_hackathon_ui.html) while the local server is running. It uses sample data and links back to the connected app.

---

## 🏗️ Technical Architecture & Backend Baseline

The app and API use these services.
- **Framework**: Next.js 16 (App Router / Turbopack), TypeScript 5.9.
- **Security & Database**: Firebase Authentication (ID Token verification), Cloud Firestore with strict security rules, Cloud Functions (Pub/Sub & Scheduler).
- **AI Intelligence**: Optional Gemini prescription document extraction with patient review.
- **Reliability & Idempotency**: Transactional leases, deduplicated Pub/Sub sweeps, and 24-hour cryptographic idempotency keys.
- **API Surface**: 34 authenticated operations + public health check (`/api/v1/health`).

---

## 🧪 Verification

Run the unit, rules, build, and API checks locally.

```sh
npm test              # Contract and time-zone recurrence unit tests
npm run test:rules    # Firestore client security rules tests
npm run test:e2e      # Public HTTP health check
npm run test:backend  # Auth and Firestore emulator tests
npm run lint
npm run typecheck
npm run build
npm --prefix functions run build
```

---

To include the two-account browser flow, install Chromium with `npx playwright install chromium`, set `SAATHI_TEST_UI=1` in your shell, and run `npm run test:backend`. To use an existing Chromium-based browser, set `SAATHI_UI_BROWSER_PATH` to its executable. In PowerShell use `$env:SAATHI_TEST_UI = "1"` and run `npm.cmd` if execution policy blocks `npm.ps1`.

## ⚙️ Local Development Quickstart

### Prerequisites
- Node.js 22 LTS or Node.js 24
- Java 21 or Java 25 (for Firestore local emulator)
- Firebase CLI (`firebase-tools`)

### 1. Clone & Install
```bash
git clone https://github.com/Atharva486dherange/catalyst-.git
cd catalyst-
npm ci
npm --prefix functions ci
```

### 2. Environment Setup
Copy `.env.example` to `.env.local`:
```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
# Place the generated base64 string in INVITATION_ENCRYPTION_KEY inside .env.local
```

### 3. Run Local Emulators & Dev Server
```bash
# Terminal 1: Start Auth & Firestore Emulators
npm run emulators

# Terminal 2: Start Next.js Development Server
npm run dev
```

- Connected app: `http://localhost:3000`
- Public Health Check: `http://localhost:3000/api/v1/health`
- Firebase Emulator Suite UI: `http://127.0.0.1:4000`

---

## ☁️ Hosted Deployment Setup

Follow the deployment checklist for Google Cloud & Firebase:
1. **Firestore**: Deploy rules and composite indexes:
   ```bash
   npx firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
   ```
2. **App Hosting**: Connect the repository to Firebase App Hosting. Enable Firebase email/password authentication and set the web app values from .env.example at build time. Use the hosted project ID and omit emulator settings. Set server runtime secrets (`GEMINI_API_KEY`, `INVITATION_ENCRYPTION_KEY`).
3. **Cloud Functions & Scheduler**: Deploy scheduled sweep workers:
   ```bash
   npx firebase deploy --only functions --project YOUR_PROJECT_ID
   ```
4. **Resend Email & Gemini**: Provide runtime secret keys in Google Secret Manager to enable live delivery and vision extraction.

### Which keys are needed

- **Local emulator demo** uses the demo project and synthetic accounts from `npm run demo:seed`. It needs no cloud API keys or payment integration. To create invitations locally, set the generated `INVITATION_ENCRYPTION_KEY` described above.
- **Hosted sign-in** uses the `apiKey`, `authDomain`, `appId`, and `projectId` from the registered Firebase web app. Set the matching `NEXT_PUBLIC_FIREBASE_*` build variables and the server's `FIREBASE_PROJECT_ID`. Enable email/password sign-in and remove emulator settings from the hosted configuration.
- **Live prescription extraction** uses `GEMINI_API_KEY` as a server runtime secret, along with a supported `GEMINI_MODEL` and `GEMINI_ENABLE_PRESCRIPTION_EXTRACTION=true`. Verify with synthetic files first.
- **Live invitation and reminder email** uses a Resend sending key, a verified sender, and the hosted HTTPS app origin. Configure `RESEND_API_KEY` as a Functions secret and set `RESEND_FROM_EMAIL`, `APP_ORIGIN`, and `ENABLE_OUTBOUND_EMAIL=true`. Share the same 32-byte base64 `INVITATION_ENCRYPTION_KEY` between the app and the delivery worker.

Store server secrets in Secret Manager. Copy only public Firebase web configuration to `NEXT_PUBLIC_*` variables.

---

## 📚 Project Documentation & References

- [HTTP API Contract](docs/API_CONTRACT.md) — Schemas and endpoints for all 34 operations.
- [Architecture & Boundaries](docs/ARCHITECTURE.md) — Transaction boundaries and concurrency design.
- [Build Status](docs/BUILD_STATUS.md) — Current implementation and test coverage.
- [Backend Scope & Roadmap Handoff](docs/BUILD_STATUS.md) — Submission status and future module sequence.

---

## 👥 Team

**Team Name:** THE SHADOW MAN  
**Team Member:** Atharva Balasaheb Dherange  
**Event:** PromptWars × Catalyst  
**Challenge:** Elderly Care & Medication Management Platform  

---

<p align="center">
  <b>SAATHI — Care That Stays Close.</b><br/>
  <i>Making elderly care simpler, safer, and deeply human.</i>
</p>
