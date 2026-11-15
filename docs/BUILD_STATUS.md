# SAATHI build status

## Implemented

- The public health route and the 34 authenticated operations documented in the API contract.
- Firebase ID token verification, patient-owned profiles, explicit delegated grants, expiring invitations, and immediate membership revocation.
- Medication CRUD through archival, time-zone-aware schedules, controlled occurrence generation, separate patient and caregiver evidence, duplicate protection, and review for discrepancies.
- Care Circle escalation, optional unresolved-task filter (`open` and `claimed`), caregiver claim and resolution, appointments, adherence insights, and an audit history.
- Scheduled Cloud Functions for rolling occurrences, reminders, missed-dose escalation, and email delivery. The worker uses transactional leases and a stable provider key for retries.
- The scheduled sweep marks expired invitations and clears their encrypted email codes while outbound email is disabled.
- Opt-in Gemini extraction, validated candidates, and a human review workflow. Extraction and review do not update medication records.

## Deployment and handoff

- The backend is set up for the linked GitHub repository. The root layout, screens, and components belong to the frontend implementation.
- Hosted Firebase provisioning remains pending. Follow the README for Authentication, Firestore rules and indexes, App Hosting, Cloud Functions, and Scheduler.
- Resend and Gemini default to disabled and still require real service configuration and live verification. Emulator tests exercise email retries using a test transport and use synthetic data for prescription review.
- Use the shared request and response schemas from the API contract to integrate the frontend.

## Verified locally

- Lint, strict type checking, and the Next.js and Functions builds passed.
- All 14 tests passed across the contract and recurrence units, Firestore rules, HTTP health check, and backend emulator suites.
- The backend suite verified consent revocation, duplicate-report protection, independent verification, task ownership, unresolved-task filtering, and reminder retry deduplication.
- Both scheduled workers registered in the Functions and Pub/Sub emulators.
- Both production dependency audits reported zero known vulnerabilities at verification time.
- Local verification used Node.js 24 and Java 21 or 25.

## Development

The documented deployment target is Node.js 22. Use Java 21 for the Firestore emulator. The Playwright suites use HTTP requests and require no browser installation.
