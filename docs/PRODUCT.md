# SAATHI product brief

SAATHI is a voice-first elderly care coordination platform for PromptWars × Catalyst. It helps patients, family members, and caregivers coordinate medication and appointments while keeping the patient in control of who can see their records.

| Experience | MVP goal |
| --- | --- |
| My Day | See today's medications and upcoming appointments, report whether a scheduled dose was taken, and ask for help. |
| Family Care Dashboard | See consented care updates and distinguish patient reports, verified administration, missed doses, and records awaiting review. |
| Caregiver Care Tasks | Acknowledge an assigned Care Circle task, check on the patient, and record the outcome. |

## Care Circle

A scheduled reminder prompts the patient to confirm the recorded medicine, amount, and scheduled occurrence or request help. A help request or an unconfirmed occurrence past the review window opens a task. An eligible caregiver is notified and can claim the task. If the caregiver checks administration independently, they use the verification flow. Authorized family members see the resulting status.

Every dose retains the distinction between a patient report and caregiver verification. An uncertain or discrepant report requires review. Resolving a task leaves administration status controlled by the dose workflow. SAATHI never marks a dose taken on its own or recommends doubling a missed dose.

Gemini proposes draft fields extracted from prescriptions. A human reviews them. Every change to a medication record requires a separate authorized action. Voice can navigate and prepare a confirmation, and submission requires explicit confirmation using the same contract as touch and keyboard input.

## Implementation phases

1. Authentication, patient profiles, invitations, consent, and authorization.
2. Medication management and the dose lifecycle, after foundation approval.
3. Care Circle tasks, scheduled processing, and notifications.
4. Appointments and family insights.
5. Human-reviewed prescription extraction and multilingual voice assistance.
6. Accessibility, security, and deployment verification.

Medicine stock and daily summaries are dashboard ideas for later planning. The first Claude handoff covers My Day and medication confirmation screens.
