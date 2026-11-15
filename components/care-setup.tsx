"use client";

import type { User } from "firebase/auth";
import { reload, sendEmailVerification } from "firebase/auth";
import { useState } from "react";
import type { FormEvent } from "react";
import { apiContracts } from "@/shared/contracts/api";
import type { ApiResponse } from "@/shared/contracts/api";
import { permissionsByRole } from "@/shared/types/domain";
import { messageFor, useCareMutation } from "./care-client";

export function CircleOnboarding({ user, onSaved, canCreate }: { user: User; onSaved: () => void; canCreate: boolean }) {
  const [verification, setVerification] = useState("");
  const [verified, setVerified] = useState(user.emailVerified);
  const create = useCareMutation(user, onSaved);
  const accept = useCareMutation(user, onSaved);

  async function createCircle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await create.run("/circles", apiContracts.createCircle.response, {
      displayName: String(data.get("name")), timeZone: String(data.get("timeZone")),
    });
  }

  async function acceptInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await accept.run("/invitations/accept", apiContracts.acceptInvitation.response, { code: String(data.get("code")).trim() });
  }

  return (
    <div className="setup-grid">
      {canCreate && (
        <section className="surface">
          <h2>Create your Care Circle</h2>
          <p>Set up your patient profile and local time zone.</p>
          <form className="inline-form" onSubmit={createCircle}>
            <label>Patient name<input name="name" maxLength={120} required /></label>
            <label>Time zone<input name="timeZone" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} required /></label>
            <button type="submit" disabled={create.pending}>Create circle</button>
          </form>
          {create.error && <p className="error" role="alert">{create.error}</p>}
        </section>
      )}
      <section className="surface">
        <h2>Accept an invitation</h2>
        <p>Use the code sent to this account’s email address.</p>
        <form className="inline-form" onSubmit={acceptInvitation}>
          <label>Invitation code<input name="code" minLength={43} maxLength={43} autoComplete="off" required /></label>
          <button type="submit" disabled={accept.pending || !verified}>Join Care Circle</button>
        </form>
        {!verified && <div className="actions">
          <button className="text-button" type="button" onClick={async () => {
            try {
              await sendEmailVerification(user);
              setVerification("Verification email requested. Open its link and then check verification.");
            } catch (error) { setVerification(messageFor(error)); }
          }}>Send verification email</button>
          <button className="text-button" type="button" onClick={async () => {
            try {
              await reload(user);
              await user.getIdToken(true);
              setVerified(user.emailVerified);
              setVerification(user.emailVerified ? "Email verified." : "Complete the email verification link first.");
            } catch (error) { setVerification(messageFor(error)); }
          }}>Check verification</button>
        </div>}
        {verification && <p className="notice" role="status">{verification}</p>}
        {accept.error && <p className="error" role="alert">{accept.error}</p>}
      </section>
    </div>
  );
}

type Medication = ApiResponse<"createMedication">["data"];
type Member = ApiResponse<"listMemberships">["data"]["items"][number];

export function PatientSettings({ user, path, timeZone, today, medications, members, refresh }: {
  user: User;
  path: string;
  timeZone: string;
  today: string;
  medications: Medication[];
  members: Member[];
  refresh: () => void;
}) {
  const medication = useCareMutation(user, refresh);
  const schedule = useCareMutation(user, refresh);
  const access = useCareMutation(user, refresh);
  const [role, setRole] = useState<"caregiver" | "family">("caregiver");
  const [notice, setNotice] = useState("");
  const active = medications.filter(({ state }) => state === "active");

  return (
    <div className="setup-grid">
      <section className="surface">
        <h2>Medicines and schedules</h2>
        <form className="inline-form" onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const saved = await medication.run(`${path}/medications`, apiContracts.createMedication.response, {
            name: data.get("name"),
            prescribedAmount: { value: data.get("amount"), unit: data.get("unit") },
          });
          if (saved) { form.reset(); setNotice(`${saved.name} added. Set its daily schedule below.`); }
        }}>
          <label>Medicine name<input name="name" maxLength={120} required /></label>
          <div className="form-columns">
            <label>Prescribed amount<input name="amount" inputMode="decimal" required /></label>
            <label>Unit<input name="unit" placeholder="mg or tablets" maxLength={30} required /></label>
          </div>
          <button type="submit" disabled={medication.pending}>Add medicine</button>
        </form>
        {medication.error && <p className="error" role="alert">{medication.error}</p>}
        {active.length > 0 && <form className="inline-form divided" onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const saved = await schedule.run(`${path}/schedules`, apiContracts.createSchedule.response, {
            medicationId: data.get("medication"), localTimes: [data.get("time")], timeZone, startDate: data.get("start"),
          });
          if (saved) setNotice(saved.needsReview ? "Schedule saved and needs review." : "Daily schedule saved.");
        }}>
          <label>Medicine<select name="medication" required defaultValue="">
            <option value="" disabled>Choose medicine</option>
            {active.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <div className="form-columns">
            <label>Daily time<input name="time" type="time" required /></label>
            <label>Start date<input name="start" type="date" defaultValue={today} required /></label>
          </div>
          <button type="submit" disabled={schedule.pending}>Save daily schedule</button>
        </form>}
        {schedule.error && <p className="error" role="alert">{schedule.error}</p>}
      </section>
      <section className="surface">
        <h2>Circle access</h2>
        <form className="inline-form" onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const saved = await access.run(`${path}/invitations`, apiContracts.createInvitation.response, {
            email: data.get("email"), consent: { role, permissions: ["care:read", ...data.getAll("grant")] },
          });
          if (saved) { form.reset(); setNotice("Invitation queued. Delivery depends on the email service."); }
        }}>
          <label>Email address<input name="email" type="email" required /></label>
          <label>Role<select value={role} onChange={(event) => setRole(event.target.value === "family" ? "family" : "caregiver")}>
            <option value="caregiver">Caregiver</option><option value="family">Family</option>
          </select></label>
          <fieldset key={role}>
            <legend>Permissions</legend>
            <p>View care records is included.</p>
            {permissionsByRole[role].filter((item) => item !== "care:read").map((item) => (
              <label className="check" key={item}><input type="checkbox" name="grant" value={item} />{
                ({ "dose:verify": "Verify doses", "escalation:respond": "Claim and resolve tasks", "insights:read": "View adherence insights" })[item]
              }</label>
            ))}
          </fieldset>
          <button type="submit" disabled={access.pending}>Queue invitation</button>
        </form>
        {members.filter(({ state }) => state === "active").map((member) => <div className="access-row" key={member.uid}>
          <div><strong>{member.email}</strong><p>{member.consent.role}</p></div>
          <button className="secondary" type="button" disabled={access.pending} onClick={async () => {
            const saved = await access.run(`${path}/members/${member.uid}/revoke`, apiContracts.revokeMembership.response);
            if (saved) setNotice("Access revoked.");
          }}>Revoke access</button>
        </div>)}
        {access.error && <p className="error" role="alert">{access.error}</p>}
      </section>
      {notice && <p className="notice" role="status">{notice}</p>}
    </div>
  );
}
