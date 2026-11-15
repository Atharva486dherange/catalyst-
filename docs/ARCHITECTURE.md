# SAATHI architecture

## Runtime and ownership

- Next.js App Router serves the frontend and the authenticated versioned HTTP API on Firebase App Hosting. Requests carry Firebase Auth ID tokens. Firebase Admin verifies identity and reads or writes Firestore only after application authorization.
- Firebase Cloud Functions host background workers. Cloud Scheduler invokes private reminder and escalation sweeps. The application API owns user-initiated mutations. Workers use scoped service identities.
- Resend sends generic authenticated-app notifications. Gemini processes prescription input in an explicitly authorized server flow. Both integrations default to disabled until configured for the deployment.
- Claude owns layouts, screens, and components. Codex owns `app/api`, `lib/firebase`, `lib/api`, `lib/validations`, `shared`, `functions`, Firestore configuration, backend docs, and backend tests. The recommended integration order is to merge `backend/foundation` before feature branches. Antigravity can continue from the same files.
- The public health route reports liveness. Authenticated handlers initialize Firebase Admin lazily, verify Firebase ID tokens and revocation, and perform scoped reads or writes in Firestore transactions.

## Roles and authorization

A Firebase UID can hold different roles across circles. The patient creates and owns their own circle. A delegated member requires an active grant approved by that circle's patient. Delegated permissions are the intersection of the role's allowed permissions and the recorded grant. Identity claims establish identity and verified email. Firestore membership establishes authorization.

| Operation | Patient owner | Family | Caregiver |
| --- | --- | --- | --- |
| Manage profile, grants, invitations, default assignee | Yes | | |
| View care profile, medications, schedules, doses, appointments, tasks | Yes | `care:read` | `care:read` |
| Create/archive medications, manage schedules and appointments | Yes | | |
| Report their own dose or request help | Yes | | |
| Independently verify or flag a dose for review | | | `dose:verify` |
| Claim and resolve a Care Circle task | | | `escalation:respond` and task eligibility |
| Read adherence insights | Yes | `insights:read` | |
| Submit/review extraction, read audit history | Yes | | |

All Firestore client reads and writes are denied, including authenticated client reads. Firebase Admin bypasses these rules, so endpoints authorize against the circle and active grant before reading or returning data. Mutations check membership and relevant resource state in the same transaction as the write. Revocation takes effect for subsequent operations, invalidates pending access where applicable, and reopens tasks held by the revoked member. A private recovery queue handles large batches. Regranting access requires a new invitation.

## Firestore model

Use server-generated opaque IDs, except where a document key enforces uniqueness. Store instants as Firestore Timestamps. Use server timestamps for creation, updates, access changes, and recorded actions. A patient's account uses its Firebase UID as the ownership index in `users` and its patient membership key. The API exposes only values specified by its response schemas.

| Path | Fields and invariants |
| --- | --- |
| `users/{uid}` | `ownedCircleId`, `createdAt`, `updatedAt`. A transaction allows one patient-owned circle per account. |
| `circles/{circleId}` | `patientUid`, `displayName`, `timeZone`, `defaultCaregiverUid`, timestamps. Contains the initial patient profile. |
| `circles/{circleId}/members/{uid}` | `uid`, `role`, `permissions`, `state`, `consentedAt`, `consentedByUid`, timestamps. The patient membership is created with the circle. |
| `invitations/{inviteId}` | `circleId`, email, role, permissions, `secretDigest`, patient consent provenance, `state`, `expiresAt`, timestamps. Derive the document ID from the digest of a cryptographically random 32-byte code and keep plaintext codes out of Firestore. Enqueue an encrypted code for invitation delivery in the creation transaction, decrypt it only in the mail worker, and delete the ciphertext after delivery or cancellation. Separate the entered code from the authenticated app URL. |
| `circles/{circleId}/medications/{medicationId}` | Human-entered name and prescribed decimal amount/unit, `state`, timestamps. Archive to preserve history. |
| `circles/{circleId}/schedules/{scheduleId}` | Medication ID, IANA time zone, daily wall-clock times and inclusive dates, `state`, timestamps. Replacements use a new schedule ID. |
| `circles/{circleId}/doseOccurrences/{doseId}` | Deterministic key from schedule ID and scheduled instant. Store immutable medication name/amount snapshot, `scheduledAt`, `reviewAfter`, `state`, patient and caregiver evidence, and timestamps. |
| `circles/{circleId}/appointments/{appointmentId}` | Title, optional location, start/end instants, `state`, timestamps. |
| `circles/{circleId}/escalations/{doseId}` | One task per occurrence. Store `doseId`, reason, `assigneeUid`, `ownerUid`, `state`, and timestamps. |
| `circles/{circleId}/extractions/{extractionId}` | Parsed candidates, human-reviewed items, state, timestamps. No source files in Firestore. |
| `circles/{circleId}/auditEvents/{eventId}` | Append-only actor UID, action, resource ID, timestamp, and minimal transition fields. Omit tokens, contact values, prescription contents, and free-text notes. |
| `notificationJobs/{jobId}` | Deterministic event/recipient key, references, state, available time, lease, attempts, and delivery metadata. Keep contact lookup behind the worker. |
| `circles/{circleId}/idempotencyKeys/{keyHash}` | Hash scoped to subject, operation, resource and key, with a request fingerprint, contract-shaped replay response, and 24-hour expiry. The replay response is private Firestore data. Initial circle creation and invitation acceptance use the same approach under `users/{uid}/idempotencyKeys`. |

The checked-in composite indexes cover active membership discovery by UID across circles, invitation expiry, due occurrence sweeps across circles, per-circle dose state/date queries, scheduled appointments, task state/time queries, and ready notification jobs. Use document IDs as pagination tie-breakers. Keep the Firestore region and cross-service locations consistent.

## Transaction boundaries

- Consume an invitation, create its membership, and add its audit event atomically. Verify the signed-in account's email and invitation expiry in that transaction. Pending invitations grant zero record access. Use one active membership per UID per circle.
- The scheduled sweep marks expired invitations and cancels their queued or leased delivery jobs in the same transaction, removing the encrypted code even while outbound email is disabled.
- Compare the explicit medicine name/ID, amount/unit, and scheduled instant against the immutable occurrence snapshot. Preserve client-asserted administration time as evidence separately from the server timestamp. Perform an evidence write, state transition, and audit append together. Preserve one patient report and one independent verification per occurrence. A mismatch moves the occurrence to review without recording successful verification.
- Materialize occurrences with deterministic IDs using a rolling 14-day horizon. For daylight-saving overlaps use the first occurrence of a local wall time. A nonexistent local time requires schedule review. Serialize conflicting changes to schedule/occurrence state with transactions. Keep historical snapshots.
- An escalation sweep transitions eligible overdue occurrences and creates at most one task and outbox event per occurrence. Prefer the valid patient-selected caregiver. If none is eligible, leave the task available to caregivers with the appropriate grant. Claim atomically. The claimed caregiver can resolve the task. Resolving a task never writes an administration outcome.
- Delivery workers claim jobs with a transaction and expiring lease. Reuse the same provider idempotency key for bounded retries within the provider's deduplication window. An ambiguous send after that window requires review. Audit durable application state separately from infrastructure logs.
- Prescription extraction is opt-in and independent of medication writes. Validate media type, file signature, and size before processing. Establish the deployment's prescription data handling and retention before enabling real uploads. Use synthetic files for the hackathon demo. Model output is untrusted and review never directly creates or edits medication records.
