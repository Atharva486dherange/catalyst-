"use client";

import { Temporal } from "@js-temporal/polyfill";
import {
  browserSessionPersistence, createUserWithEmailAndPassword, onAuthStateChanged, setPersistence,
  signInWithEmailAndPassword, signOut,
} from "firebase/auth";
import type { Auth, User } from "firebase/auth";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getBrowserAuth } from "@/lib/firebase/browser";
import { apiContracts } from "@/shared/contracts/api";
import type { ApiResponse } from "@/shared/contracts/api";
import { careList, careRequest, messageFor } from "./care-client";
import { AppointmentCard, AppointmentCreateForm, DoseCard, TaskCard } from "./care-records";
import type { Dose, Task } from "./care-records";
import { PrescriptionExtractionSection } from "./care-extraction";
import { CircleOnboarding, PatientSettings } from "./care-setup";

type Circle = ApiResponse<"listCircles">["data"]["items"][number];
type Profile = ApiResponse<"getCircle">["data"];
type Appointment = ApiResponse<"listAppointments">["data"]["items"][number];
type Medication = ApiResponse<"listMedications">["data"]["items"][number];
type Member = ApiResponse<"listMemberships">["data"]["items"][number];
type Load<T> = { value: T; error?: never } | { error: string; value?: never };
type Tab = "day" | "tasks" | "settings";

const tabNames: Record<Tab, string> = { day: "My Day", tasks: "Care Circle", settings: "Manage care" };

function Brand() {
  return <div className="brand"><span className="brand-icon" aria-hidden="true">♡</span><span>Saathi</span></div>;
}

function SignIn({ auth }: { auth: Auth }) {
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    setPending(true);
    try {
      await setPersistence(auth, browserSessionPersistence);
      const email = String(data.get("email")).trim();
      const password = String(data.get("password"));
      if (creating) await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      setError(messageFor(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="shell signin-main" id="main">
      <div className="signin-layout">
        <section className="welcome">
          <h1>My Care Circle</h1>
          <p>See what’s scheduled today, report a dose, and ask someone you trust to check in.</p>
          <div className="welcome-note">
            <span className="welcome-mark" aria-hidden="true">♡</span>
            <div><strong>Care Circle follow-up</strong><p>A caregiver can claim a task and record the outcome.</p></div>
          </div>
        </section>
        <section className="surface signin">
          <h2>{creating ? "Create an account" : "Sign in"}</h2>
          <form className="inline-form" onSubmit={submit}>
            <label>Email address<input name="email" type="email" autoComplete="email" required /></label>
            <label>Password<input name="password" type="password" autoComplete={creating ? "new-password" : "current-password"}
              minLength={creating ? 6 : undefined} required /></label>
            <button type="submit" disabled={pending}>{pending ? "Please wait…" : creating ? "Create account" : "Sign in"}</button>
          </form>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="text-button switch-mode" disabled={pending} type="button" onClick={() => { setCreating(!creating); setError(""); }}>
            {creating ? "Already have an account? Sign in" : "Create an account"}
          </button>
        </section>
      </div>
    </main>
  );
}

function dateRange(now: Temporal.ZonedDateTime) {
  const start = now.startOfDay();
  return new URLSearchParams({
    from: start.toInstant().toString({ smallestUnit: "millisecond" }),
    to: now.add({ days: 1 }).startOfDay().toInstant().toString({ smallestUnit: "millisecond" }),
  });
}

interface Workspace {
  profile: Profile;
  today: string;
  dateLabel: string;
  loadedAt: number;
  doses: Dose[];
  tasks: Task[];
  appointments: Appointment[];
  medications: Medication[];
  members: Member[];
}

async function readWorkspace(user: User, path: string, patient: boolean, unresolvedOnly: boolean): Promise<Workspace> {
  const profile = await careRequest(user, path, apiContracts.getCircle.response);
  const clock = Temporal.Now.zonedDateTimeISO(profile.timeZone);
  const [doses, tasks, appointments, medications, members] = await Promise.all([
    careList(user, `${path}/doses?${dateRange(clock)}`, apiContracts.listDoses.response),
    careList(user, `${path}/escalations${unresolvedOnly ? "?status=unresolved" : ""}`, apiContracts.listEscalations.response),
    careList(user, `${path}/appointments`, apiContracts.listAppointments.response),
    patient ? careList(user, `${path}/medications`, apiContracts.listMedications.response) : [],
    patient ? careList(user, `${path}/members`, apiContracts.listMemberships.response) : [],
  ]);
  return {
    profile,
    today: clock.toPlainDate().toString(),
    dateLabel: new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", timeZone: profile.timeZone }).format(clock.epochMilliseconds),
    loadedAt: clock.epochMilliseconds,
    doses, tasks, appointments, medications, members,
  };
}

function CircleView({ user, circle }: { user: User; circle: Circle }) {
  const [tab, setTab] = useState<Tab>(() => circle.role === "caregiver" ? "tasks" : "day");
  const [revision, setRevision] = useState(0);
  const [settled, setSettled] = useState<{ revision: number; load: Load<Workspace> } | null>(null);
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const patient = circle.role === "patient";
  const canRespond = circle.permissions.includes("escalation:respond");
  const canVerify = circle.permissions.includes("dose:verify");
  const path = `/circles/${circle.id}`;
  const refresh = () => setRevision((value) => value + 1);

  useEffect(() => {
    let active = true;
    readWorkspace(user, path, patient, unresolvedOnly).then(
      (value) => { if (active) setSettled({ revision, load: { value } }); },
      (error: unknown) => { if (active) setSettled({ revision, load: { error: messageFor(error) } }); },
    );
    return () => { active = false; };
  }, [user, path, patient, revision, unresolvedOnly]);

  const data = settled?.load.value;
  const tabs: Tab[] = patient ? ["day", "tasks", "settings"] : ["day", "tasks"];
  const activeTasks = data?.tasks.filter(({ state }) => state !== "resolved").length ?? 0;
  const shownTasks = data?.tasks.filter(({ state }) => !unresolvedOnly || state !== "resolved") ?? [];
  const doses = data?.doses.filter(({ state }) => state !== "cancelled") ?? [];
  const reportedCount = doses.filter(({ state }) => state === "patient_reported" || state === "verified").length;
  const reviewCount = doses.filter(({ state }) => state === "needs_review" || state === "missed").length;

  return (
    <div className="circle-view">
      <div className="workspace-bar">
        <nav aria-label="Care workspace">
          {tabs.map((item) => <button key={item} type="button" aria-current={tab === item ? "page" : undefined}
            onClick={() => { setTab(item); if (item === "tasks") refresh(); }}>{tabNames[item]}</button>)}
        </nav>
        <button type="button" className="secondary refresh" onClick={refresh} disabled={revision !== (settled?.revision ?? 0)}>Refresh</button>
      </div>
      <section className="workspace-hero">
        <p>{data?.dateLabel ?? circle.displayName}</p>
        <h1>{tabNames[tab]}</h1>
        <div className="hero-details">
          <span>{circle.displayName}</span><span className="role">{circle.role}</span>
        </div>
      </section>
      {settled?.load.error && <p className="error standalone" role="alert">{settled.load.error}</p>}
      {!settled && <p className="standalone" role="status">Loading your care records…</p>}
      {data && tab === "day" && (
        <div className="dashboard">
          <section className="surface" aria-labelledby="dose-heading">
            <div className="section-heading"><h2 id="dose-heading">Today’s doses</h2><span>{doses.length} doses</span></div>
            {doses.length ? doses.map((dose) => <DoseCard key={dose.id} {...{ user, path, dose, patient, refresh }}
              timeZone={data.profile.timeZone} loadedAt={data.loadedAt} verify={canVerify} />) : (
              <div className="empty"><p>No doses scheduled for today.</p>{patient && <button type="button" className="secondary"
                onClick={() => setTab("settings")}>Add a medicine or schedule</button>}</div>
            )}
          </section>
          <aside className="dashboard-aside">
            <section className="surface summary">
              <h2>Today at a glance</h2>
              <dl><div><dt>Reported or verified</dt><dd>{reportedCount}</dd></div><div><dt>Missed or needs review</dt><dd>{reviewCount}</dd></div>
                <div><dt>Unresolved care tasks</dt><dd>{activeTasks}</dd></div></dl>
              <button type="button" className="text-button" onClick={() => { setTab("tasks"); refresh(); }}>View Care Circle</button>
            </section>
            <section className="surface" aria-labelledby="appointments-heading">
              <div className="section-heading">
                <h2 id="appointments-heading">Upcoming appointments</h2>
                {patient && (
                  <AppointmentCreateForm
                    user={user}
                    path={path}
                    timeZone={data.profile.timeZone}
                    refresh={refresh}
                  />
                )}
              </div>
              {data.appointments.length ? (
                data.appointments.map((item) => (
                  <AppointmentCard
                    key={item.id}
                    user={user}
                    path={path}
                    appointment={item}
                    timeZone={data.profile.timeZone}
                    patient={patient}
                    refresh={refresh}
                  />
                ))
              ) : (
                <p style={{ marginTop: ".5rem" }}>No upcoming appointments.</p>
              )}
            </section>
            {patient && <PrescriptionExtractionSection user={user} path={path} />}
          </aside>
        </div>
      )}
      {data && tab === "tasks" && (
        <section className="surface tasks" aria-labelledby="task-heading">
          <div className="section-heading">
            <h2 id="task-heading">Follow-up tasks</h2>
            <label className="check"><input type="checkbox" checked={unresolvedOnly} onChange={(event) => setUnresolvedOnly(event.target.checked)} />
              Unresolved only</label>
          </div>
          {shownTasks.length ? shownTasks.map((task) => <TaskCard key={task.id} {...{ user, path, task, canRespond, refresh }}
            timeZone={data.profile.timeZone} dose={data.doses.find(({ id }) => id === task.doseId)} />) : <p className="empty">No matching follow-up tasks.</p>}
        </section>
      )}
      {data && tab === "settings" && <PatientSettings {...{ user, path, refresh }} timeZone={data.profile.timeZone}
        today={data.today} medications={data.medications} members={data.members} />}
    </div>
  );
}

function SignedIn({ user }: { user: User }) {
  const [circles, setCircles] = useState<Load<Circle[]> | null>(null);
  const [selected, setSelected] = useState("");
  const [joining, setJoining] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    careList(user, "/circles", apiContracts.listCircles.response).then(
      (value) => { if (active) setCircles({ value }); },
      (error: unknown) => { if (active) setCircles({ error: messageFor(error) }); },
    );
    return () => { active = false; };
  }, [user, revision]);

  const circle = circles?.value?.find(({ id }) => id === selected) ?? circles?.value?.[0];
  return (
    <main className="shell workspace-main" id="main">
      {!circles && <p role="status">Loading your Care Circles…</p>}
      {circles?.error && <div className="surface"><p className="error" role="alert">{circles.error}</p>
        <button type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button></div>}
      {circle && <div className="circle-switch">
        {(circles?.value?.length ?? 0) > 1 && <label>Active circle<select value={circle.id} onChange={(event) => { setSelected(event.target.value); setJoining(false); }}>
          {circles?.value?.map((item) => <option key={item.id} value={item.id}>{item.displayName} ({item.role})</option>)}
        </select></label>}
        <button type="button" className="text-button" onClick={() => setJoining(!joining)}>{joining ? "Back to workspace" : "Join another circle"}</button>
      </div>}
      {circles?.value && (!circle || joining) && <CircleOnboarding user={user} canCreate={!circles.value.some(({ role }) => role === "patient")}
        onSaved={() => { setRevision((value) => value + 1); setJoining(false); }} />}
      {circle && !joining && <CircleView key={circle.id} user={user} circle={circle} />}
    </main>
  );
}

export function CareWorkspace() {
  const [session, setSession] = useState<{ auth: Auth; user: User | null } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState("");
  const [bigText, setBigText] = useState(false);

  function toggleBigText() {
    const next = !bigText;
    setBigText(next);
    if (typeof document !== "undefined") {
      document.body.classList.toggle("big", next);
    }
  }

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    Promise.resolve().then(() => {
      if (!active) return;
      const auth = getBrowserAuth();
      if (!auth) { setUnavailable(true); return; }
      unsubscribe = onAuthStateChanged(auth, (user) => { if (active) setSession({ auth, user }); });
    }).catch(() => { if (active) setUnavailable(true); });
    return () => { active = false; unsubscribe?.(); };
  }, []);

  return (
    <>
      <a className="skip" href="#main">Skip to main content</a>
      <header className="site-header">
        <div className="shell header-content">
          <Brand />
          <div className="header-actions">
            <a
              href="/saathi_hackathon_ui.html"
              className="tool preview-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              Sample preview
            </a>
            <button
              type="button"
              className={`tool ${bigText ? "active" : ""}`}
              onClick={toggleBigText}
              aria-pressed={bigText}
            >
              Larger text
            </button>
            {session?.user && (
              <div className="account">
                <span>{session.user.email}</span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setError("");
                    void signOut(session.auth).catch((error: unknown) =>
                      setError(messageFor(error))
                    );
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {error && <p className="error shell" role="alert">{error}</p>}
      {session?.user ? <SignedIn key={session.user.uid} user={session.user} /> :
        session ? <SignIn auth={session.auth} /> :
          <main className="shell workspace-main" id="main">
            {unavailable ? <section className="surface"><h1>Sign-in setup required</h1>
              <p>Configure the Firebase web app or start the local Auth emulator with the project’s development settings.</p></section> :
              <p role="status">Connecting to Saathi…</p>}
          </main>}
    </>
  );
}
