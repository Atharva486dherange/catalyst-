"use client";

import { Temporal } from "@js-temporal/polyfill";
import type { User } from "firebase/auth";
import { useState } from "react";
import type { FormEvent } from "react";
import { apiContracts, escalationOutcomeSchema } from "@/shared/contracts/api";
import type { ApiResponse } from "@/shared/contracts/api";
import { doseActionSchema } from "@/shared/types/domain";
import type { DoseState } from "@/shared/types/domain";
import { useCareMutation } from "./care-client";

export type Dose = ApiResponse<"getDose">["data"];
export type Task = ApiResponse<"claimEscalation">["data"];

const doseLabels: Record<DoseState, string> = {
  scheduled: "Scheduled",
  patient_reported: "Patient reported",
  verified: "Caregiver verified",
  needs_review: "Needs review",
  missed: "Missed",
  cancelled: "Cancelled",
};

const outcomes = {
  checked_in: "Checked in",
  referred_for_review: "Referred for review",
  unable_to_reach: "Unable to reach",
} as const;

export function formatTime(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(instant));
}

export function formatDate(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", { timeZone, month: "short", day: "numeric" }).format(new Date(instant));
}

export function DoseCard({ user, path, dose, timeZone, loadedAt, patient, verify, refresh }: {
  user: User;
  path: string;
  dose: Dose;
  timeZone: string;
  loadedAt: number;
  patient: boolean;
  verify: boolean;
  refresh: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<Dose | null>(null);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const report = useCareMutation(user, refresh);
  const current = result && result.updatedAt >= dose.updatedAt ? result : dose;
  const { name, prescribedAmount } = current.medicationSnapshot;
  const endpoint = `${path}/doses/${dose.id}/reports`;
  const isDue = Date.parse(current.scheduledAt) <= loadedAt;
  const canReport = current.state !== "cancelled" && isDue &&
    (patient ? !current.patientReportedAt : verify && !current.verifiedAt);
  const canAsk = patient && ["scheduled", "missed", "patient_reported"].includes(current.state);

  async function onReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed) return;
    setProblem("");
    const data = new FormData(event.currentTarget);
    const takenAt = String(data.get("time"));
    let administeredAt: string;
    try {
      administeredAt = Temporal.PlainDateTime.from(takenAt).toZonedDateTime(timeZone, { disambiguation: "reject" }).toInstant()
        .toString({ smallestUnit: "millisecond" });
    } catch {
      setProblem("Choose a valid date and time in this Care Circle’s time zone.");
      return;
    }
    if (Date.parse(administeredAt) > Date.now()) {
      setProblem("Enter a time that has already passed.");
      return;
    }
    const action = doseActionSchema.safeParse({
      kind: patient ? "patient_report" : "caregiver_verification",
      evidence: { medicationId: dose.medicationId, medicationName: name, amount: { value: String(data.get("amount")), unit: prescribedAmount.unit },
        scheduledAt: dose.scheduledAt, administeredAt },
    });
    if (!action.success) {
      setProblem("Enter the amount taken as a positive number.");
      return;
    }
    const updated = await report.run(endpoint, apiContracts.reportDose.response, action.data);
    if (updated) {
      setResult(updated);
      setConfirming(false);
      setConfirmed(false);
      setNotice(updated.state === "needs_review" ? "The dose was flagged for Care Circle review." : "Dose update saved.");
    }
  }

  async function askForHelp() {
    setProblem("");
    const updated = await report.run(endpoint, apiContracts.reportDose.response, { kind: "needs_help" });
    if (updated) {
      setResult(updated);
      setNotice("A follow-up task is available in Care Circle.");
    }
  }

  function readDose() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(
        `${name}, ${prescribedAmount.value} ${prescribedAmount.unit}. Scheduled for ${formatTime(dose.scheduledAt, timeZone)}.`,
      ));
    } else {
      setNotice("Read aloud is unavailable in this browser.");
    }
  }

  return (
    <article className="record">
      <div className="record-heading">
        <div>
          <h3>{name}</h3>
          <p>{prescribedAmount.value} {prescribedAmount.unit} · {formatTime(dose.scheduledAt, timeZone)}</p>
        </div>
        <span className={`state ${current.state}`}>{doseLabels[current.state]}</span>
      </div>
      {confirming ? (
        <form className="inline-form" onSubmit={onReport}>
          <label>Amount taken ({prescribedAmount.unit})<input name="amount" inputMode="decimal" defaultValue={prescribedAmount.value} required /></label>
          <label>Time taken ({timeZone})<input name="time" type="datetime-local" step="1" required defaultValue={
            Temporal.Now.zonedDateTimeISO(timeZone).toPlainDateTime().toString({ smallestUnit: "second" })
          } /></label>
          <label className="check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I confirm these details are correct.</label>
          <div className="actions">
            <button disabled={!confirmed || report.pending} type="submit">{patient ? "Submit dose report" : "Save verification"}</button>
            <button className="secondary" type="button" onClick={() => { setConfirming(false); setConfirmed(false); setProblem(""); }} disabled={report.pending}>
              {patient ? "Not yet" : "Cancel"}
            </button>
          </div>
        </form>
      ) : (
        <div className="actions">
          {canReport && <button type="button" onClick={() => { setConfirming(true); setNotice(""); }}>{patient ? "Report taken" : "Verify dose"}</button>}
          {canAsk && <button className="secondary" type="button" disabled={report.pending} onClick={askForHelp}>Ask for help</button>}
          <button className="text-button" type="button" onClick={readDose}>Read aloud</button>
        </div>
      )}
      {(problem || report.error) && <p className="error" role="alert">{problem || report.error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
    </article>
  );
}

export function TaskCard({ user, path, task, dose, timeZone, canRespond, refresh }: {
  user: User;
  path: string;
  task: Task;
  dose?: Dose;
  timeZone: string;
  canRespond: boolean;
  refresh: () => void;
}) {
  const save = useCareMutation(user, refresh);
  const [result, setResult] = useState<Task | null>(null);
  const current = result && result.updatedAt >= task.updatedAt ? result : task;
  const base = `${path}/escalations/${task.id}`;

  async function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const outcome = escalationOutcomeSchema.parse(new FormData(event.currentTarget).get("outcome"));
    const updated = await save.run(`${base}/resolve`, apiContracts.resolveEscalation.response, { outcome });
    if (updated) setResult(updated);
  }

  return (
    <article className="record">
      <div className="record-heading">
        <div>
          <h3>{dose ? `${dose.medicationSnapshot.name} follow-up` : "Dose follow-up"}</h3>
          <p>Opened {formatDate(task.openedAt, timeZone)} at {formatTime(task.openedAt, timeZone)}{current.outcome ? ` · ${outcomes[current.outcome]}` : ""}</p>
        </div>
        <span className={`state ${current.state}`}>{({ open: "Open", claimed: "Claimed", resolved: "Resolved" })[current.state]}</span>
      </div>
      {canRespond && current.state === "open" && (!current.assigneeUid || current.assigneeUid === user.uid) && (
        <button type="button" disabled={save.pending} onClick={async () => {
          const updated = await save.run(`${base}/claim`, apiContracts.claimEscalation.response);
          if (updated) setResult(updated);
        }}>Claim task</button>
      )}
      {canRespond && current.state === "claimed" && current.ownerUid === user.uid && (
        <form className="inline-form" onSubmit={resolve}>
          <label>Check-in outcome<select name="outcome" required defaultValue="">
            <option value="" disabled>Choose outcome</option>
            {Object.entries(outcomes).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select></label>
          <button disabled={save.pending} type="submit">Resolve task</button>
        </form>
      )}
      {save.error && <div className="actions"><p className="error" role="alert">{save.error}</p>
        <button className="text-button" type="button" onClick={refresh}>Refresh tasks</button>
      </div>}
    </article>
  );
}
