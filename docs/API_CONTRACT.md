# SAATHI API contract v1

Claude and Antigravity should use the operation names and Zod schemas in `shared/contracts/api.ts` and the domain schemas in `shared/types/domain.ts`. Import `ApiBody`, `ApiQuery`, and `ApiResponse` from the shared contract when typing the frontend integration.

All operations below have backend handlers. Use Firebase Auth to sign in and send its ID token. Invitation delivery and extraction also require the corresponding service configuration in the README.

## HTTP conventions

- All paths below are relative to `/api/v1`. `{circleId}` scopes every patient record. Path IDs use `idSchema`.
- Except for the health check, operations require `Authorization: Bearer <Firebase ID token>`. Send tokens over HTTPS in deployed environments. Never put credentials, invitation codes, or health details in query strings.
- Use `application/json` for JSON bodies and `multipart/form-data` only where listed. Unknown JSON fields and query keys are rejected. Actions with no body omit it. Responses use `Cache-Control: no-store`.
- Success is `{"data": ...}`. Errors are `{"error":{"code":"...","message":"...","requestId":"...","fields":[...]}}`. Field issues are optional and contain a dot-separated path and safe message. Error messages and server logs omit raw health data, invitation codes, and tokens. Branch on status and code.
- Expected errors are 400 `INVALID_INPUT`, 401 `UNAUTHENTICATED`, 403 `FORBIDDEN` for missing permissions on a visible circle, 404 `NOT_FOUND` for missing or invisible resources, 409 `CONFLICT`, 413 `PAYLOAD_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE`, 429 `RATE_LIMITED`, 500 `INTERNAL`, and 503 `UNAVAILABLE`.
- Mutations require a client-generated UUIDv4 in the `Idempotency-Key` header. Reuse the key only for retries of the same action and payload. The server rechecks authorization before replaying a result. Conflicting input for the same key returns 409. Replays are scoped to the authenticated subject, operation, and target for at least 24 hours. Domain uniqueness still applies after that window. Use a newly generated key for a distinct user action.
- Instants use UTC ISO 8601 with milliseconds. Calendar dates use `YYYY-MM-DD`. Decimal amounts are strings paired with explicit units. Server action times are independent of client-reported administration time.
- Lists return `{ items, nextCursor }`. Default limit is 20 and maximum is 50. Send returned cursors unchanged for the same query. A null cursor ends pagination. For optional timestamp filters, `from` is inclusive and `to` exclusive. Use the patient's time zone to derive the UTC bounds of My Day.

## Operations

Use `/circles/{circleId}` as the prefix for each circle-relative row. A row with `/` refers to the prefix itself. “Read grant” means the patient or a delegated member with `care:read`. “Patient” means the identified circle owner.

| Method and absolute path within v1 | Operation | Access | Success |
| --- | --- | --- | --- |
| GET `/health` | `health` | Public | 200 |
| GET `/circles` | `listCircles` | Signed-in user, own active memberships | 200 |
| POST `/circles` | `createCircle` | Signed-in user, their own one-time patient onboarding | 201 |
| POST `/invitations/accept` | `acceptInvitation` | Signed-in user with verified invited email and valid code | 200 |

| Method and circle-relative path | Operation | Access | Success |
| --- | --- | --- | --- |
| GET `/` | `getCircle` | Read grant | 200 |
| PUT `/` | `updateCircle` | Patient | 200 |
| GET `/invitations` | `listInvitations` | Patient | 200 |
| POST `/invitations` | `createInvitation` | Patient | 201 |
| POST `/invitations/{inviteId}/revoke` | `revokeInvitation` | Patient | 200 |
| GET `/members` | `listMemberships` | Patient, delegated members only | 200 |
| POST `/members/{uid}/revoke` | `revokeMembership` | Patient | 200 |
| GET `/escalation-assignee` | `getEscalationAssignee` | Patient | 200 |
| PUT `/escalation-assignee` | `setEscalationAssignee` | Patient | 200 |
| GET `/medications` | `listMedications` | Read grant | 200 |
| POST `/medications` | `createMedication` | Patient | 201 |
| PUT `/medications/{medicationId}` | `updateMedication` | Patient | 200 |
| POST `/medications/{medicationId}/archive` | `archiveMedication` | Patient | 200 |
| GET `/schedules` | `listSchedules` | Read grant | 200 |
| POST `/schedules` | `createSchedule` | Patient | 201 |
| POST `/schedules/{scheduleId}/end` | `endSchedule` | Patient | 200 |
| GET `/doses` | `listDoses` | Read grant | 200 |
| GET `/doses/{doseId}` | `getDose` | Read grant | 200 |
| POST `/doses/{doseId}/reports` | `reportDose` | Patient or caregiver with `dose:verify`, by action kind | 200 |
| GET `/appointments` | `listAppointments` | Read grant | 200 |
| POST `/appointments` | `createAppointment` | Patient | 201 |
| PUT `/appointments/{appointmentId}` | `updateAppointment` | Patient | 200 |
| POST `/appointments/{appointmentId}/cancel` | `cancelAppointment` | Patient | 200 |
| GET `/escalations` | `listEscalations` | Read grant | 200 |
| POST `/escalations/{escalationId}/claim` | `claimEscalation` | Eligible caregiver with `escalation:respond` | 200 |
| POST `/escalations/{escalationId}/resolve` | `resolveEscalation` | Claim owner with active `escalation:respond` | 200 |
| POST `/prescription-extractions` | `createExtraction` | Patient with explicit consent | 201 |
| GET `/prescription-extractions/{extractionId}` | `getExtraction` | Patient | 200 |
| POST `/prescription-extractions/{extractionId}/review` | `reviewExtraction` | Patient | 200 |
| GET `/insights` | `getInsights` | Patient or family with `insights:read` | 200 |
| GET `/audit-events` | `listAudit` | Patient | 200 |

## Behavior details

- A patient creates their profile and patient membership in one operation. Invite creation requires the patient's verified email, records the explicitly approved role and scopes, and queues delivery. A circle can create up to 15 invitations per UTC day and have one pending invitation per recipient address. The invitation expires after 72 hours. Owner-only invitation and member responses include the delegated email so the patient can identify grants and pending requests. Accept using the separate 43-character invitation code in the JSON body. Invalid, expired, redeemed, or mismatched codes return a generic 404 unless replaying a committed acceptance for the same subject and key. Role or scope changes require revocation and a new invitation. Choose a default assignee from active caregivers with `escalation:respond`, or send null to clear it.
- Dose input kinds are `patient_report`, `caregiver_verification`, `uncertain`, and `needs_help`. Use the dose snapshot to display the evidence the user must explicitly check. Patient reports and verification also require the time of administration as asserted by the user. A scheduled time that has not arrived or an administration time outside the recorded schedule activation and current server time goes to review. The patient can submit a patient report or request help. The patient or an authorized caregiver can flag uncertainty. A caregiver may independently verify an occurrence. Patient reports never count as independent verification.
- A mismatch or uncertainty returns 200 with the committed state `needs_review` and no successful evidence for that attempt. `needs_help` also opens a Care Circle task. Duplicate successful evidence or an invalid transition returns 409. “Not yet” dismisses the prompt without submitting evidence. The authoritative state and evidence timestamps are returned in the dose response. Present review states distinctly from verified administration.
- A task can be claimed only while open, and only by its eligible assignee if one is set. If no assignee is set, an eligible caregiver can claim it. Store the claimant as `ownerUid`. Resolution records an outcome of `checked_in`, `referred_for_review`, or `unable_to_reach` and closes the task without changing dose evidence. Escalation task detail uses the associated dose ID for the displayed occurrence.
- Upcoming appointments are listed in start-time order and omit cancelled items. Dose lists sort by scheduled time, ascending. Audit and escalation lists put the newest first. Other lists sort by ID. Break timestamp ties by document ID. Insights counts are mutually exclusive per current occurrence state over the requested time range.
- Extraction upload has one `file` field (JPEG, PNG, or PDF, up to 5 MiB) and a `consent` field with the exact value `true`. The server returns `503 UNAVAILABLE` when extraction is disabled or the provider is unavailable. Output `pending_review` means a candidate is ready for human review. Unknown fields are represented as null in extraction candidates. Review stores user-entered corrections in the extraction record. Medication writes are separate patient actions.
- Circle summaries include granted scopes for delegated users. Patient ownership grants the patient operations directly and is represented with an empty delegated scope list.
- A medication can have one active schedule. Medication edits and archival require the active schedule to end first. Ending a schedule preserves prior snapshots and marks its future scheduled occurrences as `cancelled`. Cancelled doses are omitted from adherence counts. A schedule with a nonexistent local time exposes `needsReview: true` so the patient can replace it. A scheduled dose remains eligible for a patient reminder until its review window opens one hour after the scheduled time.
- PUT requests replace the editable fields in their body schema. Omitted optional fields are cleared. Cancel, end, archive, and revoke operations preserve records for audit history.

## Health example

```http
GET /api/v1/health
```

```json
{ "data": { "status": "ok" } }
```
