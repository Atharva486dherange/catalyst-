# catalyst

# 🌿 SAATHI
### Care That Stays Close, Even When Family Lives Far Away.

**An AI-Powered, Voice-First Elderly Care & Medication Management Platform**

SAATHI is a smart, accessible, and collaborative healthcare management platform designed to help elderly individuals manage their medications, medical appointments, and daily healthcare routines while keeping their families and caregivers connected.

Rather than functioning as another medication reminder app, SAATHI aims to create a connected care ecosystem where elderly individuals remain independent, families stay informed, and caregivers can respond when assistance is needed.

> **Our Mission:** Making elderly care simpler, safer, more accessible, and more human.

---

## 🎯 Problem Statement

**Challenge:** Elderly Care & Medication Management Platform  
**Hackathon:** PromptWars × Catalyst

Elderly individuals often face difficulties managing multiple medications, remembering appointments, and maintaining consistent healthcare routines.

Family members may live far away, while caregivers often lack a centralized system to coordinate responsibilities.

Existing medication reminder applications generally focus on sending notifications rather than ensuring that missed or unconfirmed doses receive appropriate follow-up.

### Key Challenges

- Missed or forgotten medication doses
- Difficulty managing complex medication schedules
- Lack of coordination between family members and caregivers
- Limited accessibility for elderly users
- Delayed awareness of missed medications
- Fragmented healthcare information
- Difficulty tracking appointments and medication adherence

---

## 💡 Our Solution

SAATHI connects three important participants in elderly healthcare:

1. **Elderly Individuals:** Manage daily healthcare routines through a simple, accessible interface.
2. **Family Members:** Monitor authorized care information and coordinate responsibilities.
3. **Caregivers:** Manage assigned tasks, assist with medication routines, and respond to care requests.

SAATHI combines medication management, caregiver collaboration, appointment scheduling, intelligent reminders, and AI-assisted accessibility into one platform.

---

## ✨ Key Features

### 💊 1. Smart Medication Management

- Add, edit, and manage prescribed medications
- Configure medication schedules and reminders
- Track medication adherence
- View daily medication timelines
- Record taken, skipped, and unconfirmed doses
- Maintain medication history

### 🛡️ 2. Safe Dose Verification

SAATHI uses a verification workflow before recording medication confirmation.

- Display the scheduled medicine and prescribed dose
- Ask users to confirm what they actually took
- Prevent duplicate dose confirmations
- Identify discrepancies between prescribed and reported amounts
- Support "Not Yet", "Unsure", and "Need Help" responses
- Preserve an auditable medication history

Medication confirmations represent user-reported information and do not independently verify ingestion.

SAATHI does not prescribe medications or recommend changes to prescribed doses.

### 🤝 3. Care Circle — Our Core Innovation

**Beyond reminders. Towards coordinated care.**

Care Circle transforms unresolved medication reminders into actionable caregiver tasks.

**How it works:**

1. A scheduled medication reminder is generated.
2. The elderly user can confirm the dose or request assistance.
3. If the dose remains unconfirmed, SAATHI initiates a configurable follow-up process.
4. A designated caregiver receives a notification.
5. The caregiver acknowledges responsibility.
6. The caregiver checks on the elderly person and records the outcome.
7. Authorized family members can view the updated care status.

This creates accountability and collaboration instead of simply sending repeated notifications.

### 🎙️ 4. Voice-First Accessibility

SAATHI is designed to support natural voice interactions.

Example interactions:

- "What medicines do I need today?"
- "I've taken my morning medicine."
- "When is my next appointment?"
- "I need help with my medication."

Voice input is an accessibility enhancement. Essential actions remain available through touch and keyboard controls.

### 👨‍👩‍👧 5. Family & Caregiver Dashboard

- Shared elderly healthcare profiles
- Role-based access permissions
- Daily medication status
- Upcoming medical appointments
- Caregiver task assignments
- Missed-dose notifications
- Care activity history

### 📅 6. Doctor Appointment Management

- Schedule and manage doctor appointments
- View upcoming consultations
- Configure appointment reminders
- Maintain appointment details
- Coordinate visits with caregivers

### 🤖 7. AI-Assisted Prescription Management

Planned Gemini-powered capabilities include:

- Extracting medication information from uploaded prescriptions
- Identifying medicine names and dosage instructions
- Highlighting uncertain or incomplete information
- Presenting extracted details for human review

AI-generated prescription information must be verified by an authorized user before it is saved.

---

## 🏗️ Technology Stack

| Layer | Technology |
|------|------------|
| Frontend | Next.js, React, TypeScript |
| Styling | Tailwind CSS, shadcn/ui |
| Icons | Lucide React |
| Authentication | Firebase Authentication |
| Database | Cloud Firestore |
| Backend | Firebase Cloud Functions |
| AI Integration | Google Gemini API |
| Email Notifications | Resend |
| Scheduled Jobs | Google Cloud Scheduler |
| Hosting | Firebase App Hosting |
| Testing | Vitest, Playwright, Firebase Emulator Suite |

**Development Tools:**
- OpenAI Codex — Backend development and integration
- Claude — Frontend development and UI/UX
- Google Antigravity — Additional development support

---

## 🔄 System Architecture

```text
                  SAATHI PLATFORM
                         |
           Next.js + TypeScript
                         |
        -------------------------
        |           |           |
     Elderly      Family     Caregiver
        |           |           |
        -------------------------
                         |
                 Firebase Auth
                         |
               Application Backend
                         |
         ---------------------------
         |            |            |
      Firestore    Cloud        Gemini API
                   Functions
         |            |
    Health Data   Care Workflows
                      |
              ----------------
              |              |
           Scheduler      Email Service
              |              |
           Reminders     Notifications
```

---

## 🔐 Security & Privacy

SAATHI is designed around patient privacy, secure access, and responsible healthcare data handling.

Security principles include:

- Firebase Authentication
- Role-based access control
- Patient consent for caregiver access
- Secure caregiver invitations
- Firestore security rules
- Server-side authorization
- Input validation
- Protected healthcare records
- Audit logging
- Secure environment variables
- Minimal sensitive information in email notifications

Elderly individuals should retain control over who can access their healthcare information.

**Important:** SAATHI is a care coordination tool, not a replacement for professional medical advice or emergency healthcare services.

---

## ♿ Accessibility

SAATHI follows an accessibility-first design approach.

Design goals include:

- Large, readable typography
- Minimum 48×48 px touch targets
- High-contrast interfaces
- Simple navigation
- Clearly labeled buttons
- Keyboard accessibility
- Screen-reader compatibility
- Voice interaction support
- Clear error and confirmation messages
- No reliance on color alone to communicate status

---

## 📂 Proposed Project Structure

```text
saathi/
├── app/
│   ├── (auth)/
│   ├── (dashboard)/
│   └── api/
├── components/
│   ├── ui/
│   ├── elderly/
│   ├── family/
│   └── caregiver/
├── lib/
│   ├── firebase/
│   ├── api/
│   └── validations/
├── shared/
│   ├── types/
│   └── contracts/
├── functions/
│   └── src/
├── tests/
├── docs/
│   ├── PRODUCT.md
│   ├── ARCHITECTURE.md
│   └── API_CONTRACT.md
├── firestore.rules
├── firebase.json
├── .env.example
└── README.md
```

The actual repository structure may evolve during implementation.

---

## ⚙️ Getting Started

### Prerequisites

- Node.js 20 or later
- npm
- Firebase project
- Firebase CLI
- Google Cloud project for supported cloud services
- Gemini API key for optional AI features
- Resend API key for email functionality

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/saathi.git
cd saathi
```

Replace `YOUR_USERNAME` with your GitHub username.

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env.local` file using the repository's `.env.example` as a reference.

Example Firebase client configuration:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

Backend secrets such as Gemini and Resend API keys must be configured securely in the server environment, not exposed through `NEXT_PUBLIC_` variables.

### 4. Start the Development Server

```bash
npm run dev
```

Open:

http://localhost:3000

### 5. Firebase Setup

Authenticate with Firebase:

```bash
firebase login
```

Select your Firebase project:

```bash
firebase use --add
```

Configure Firebase services according to the repository's deployment configuration.

Cloud Functions and scheduled jobs may require additional Google Cloud configuration and billing.

---

## 🧪 Testing Strategy

The project aims to cover:

**Unit Tests**
- Medication schedule validation
- Dose status transitions
- Duplicate confirmation prevention
- Care task state transitions

**Integration Tests**
- Firebase authentication
- Firestore access permissions
- Medication persistence
- Reminder processing
- Caregiver escalation

**End-to-End Tests**
- Elderly medication confirmation
- Family dashboard updates
- Caregiver task acknowledgement
- Appointment management

**Accessibility Tests**
- Keyboard navigation
- Screen-reader labels
- Color contrast
- Touch target sizes

---

## 🚀 Hackathon Demonstration

Our primary demonstration follows a real-world care scenario.

**Scenario: An elderly person misses a scheduled medication.**

1. The medication appears on the elderly dashboard.
2. SAATHI displays the scheduled reminder.
3. The dose remains unconfirmed.
4. Care Circle creates a caregiver follow-up task.
5. The assigned caregiver receives an alert.
6. The caregiver acknowledges the task.
7. The caregiver checks on the patient and records the outcome.
8. The family dashboard displays the updated status.

This demonstrates how SAATHI goes beyond reminders to support coordinated care.

---

## 🌍 Expected Impact

SAATHI aims to:

- Improve medication routine visibility
- Reduce gaps in caregiver communication
- Support elderly independence
- Make care responsibilities clearer
- Improve accessibility to digital healthcare tools
- Help families coordinate care across distances

These are intended benefits and have not yet been established through clinical evaluation.

---

## 🛣️ Future Roadmap

- Expanded regional language support
- Offline-friendly medication reminders
- Medication inventory and refill tracking
- Doctor and pharmacy integrations
- Advanced care coordination insights
- Wearable device integrations
- Caregiver availability management

---

## 🏆 Hackathon

**Event:** PromptWars × Catalyst  
**Challenge:** Elderly Care & Medication Management Platform

---

## 👥 Team
THE SHADOW MAN 
**Team Name:** [Your Team Name]

**Team Members:**
- Atharva Balasasheb Dherange 
---

## ❤️ Our Vision

Technology should help elderly people feel more independent, not more dependent.

SAATHI is built around one belief:

**Better elderly care isn't about sending more reminders. It's about making sure someone is there when help is needed.**

### SAATHI — Care That Stays Close.
