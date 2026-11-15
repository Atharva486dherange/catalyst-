import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { apiContracts } from "@/shared/contracts/api";
import type { ApiOperation } from "@/shared/contracts/api";
import { idSchema } from "@/shared/types/domain";
import type { Permission } from "@/shared/types/domain";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { answer, authenticate, failure, HttpError, input, jsonBody, mutationKey, readBytes, readQuery } from "./http";
import { access, notFound, once } from "./firestore";
import type { CircleAccess, MutationContext } from "./firestore";
import * as circles from "./circles";
import * as meds from "./medications";
import * as care from "./care";
import * as ai from "./extraction";

interface Call {
  tx: Transaction;
  db: Firestore;
  identity: DecodedIdToken;
  ids: string[];
  now: Timestamp;
}

interface Route {
  match: RegExp;
  method: "GET" | "POST" | "PUT";
  operation: ApiOperation;
  status?: number;
  execute(request: Request, ids: string[]): Promise<unknown>;
}

const id = "([A-Za-z0-9_-]{1,128})";
const circle = `circles/${id}`;
const match = (path: string) => new RegExp(`^${path}$`);

function rejectQuery(request: Request) {
  if (Object.keys(readQuery(request)).length) throw new HttpError("INVALID_INPUT", "This route does not accept query parameters.");
}

async function call(request: Request, ids: string[], run: (context: Call) => Promise<unknown> | unknown) {
  const identity = await authenticate(request);
  const db = getAdminFirestore();
  return db.runTransaction(async (tx) => run({ tx, db, identity, ids, now: Timestamp.now() }));
}

function scoped(context: Call, requirement: Permission | "patient") {
  return access(context.tx, context.db, input(idSchema, context.ids[0]), context.identity.uid, requirement);
}

type Contract = typeof apiContracts;
type WithQuery = { [K in keyof Contract]: Contract[K] extends { query: unknown } ? K : never }[keyof Contract];
type WithBody = { [K in keyof Contract]: Contract[K] extends { body: unknown } ? K : never }[keyof Contract];

interface Mutation extends Call {
  mutation: MutationContext;
}

function list<K extends WithQuery>(
  path: string, operation: K, run: (context: Call, query: ReturnType<Contract[K]["query"]["parse"]>) => Promise<unknown> | unknown,
): Route {
  return {
    method: "GET", match: match(path), operation,
    execute: (request, ids) => {
      type Query = ReturnType<Contract[K]["query"]["parse"]>;
      const query = input(apiContracts[operation].query, readQuery(request)) as Query;
      return call(request, ids, (context) => run(context, query));
    },
  };
}

function read(
  path: string, operation: ApiOperation, requirement: Permission | "patient",
  run: (context: Call, scope: CircleAccess) => Promise<unknown> | unknown,
): Route {
  return {
    method: "GET", match: match(path), operation,
    execute: (request, ids) => {
      rejectQuery(request);
      return call(request, ids, async (context) => run(context, await scoped(context, requirement)));
    },
  };
}

async function mutate(
  request: Request, ids: string[], operation: ApiOperation, body: unknown,
  run: (context: Mutation) => Promise<unknown> | unknown,
) {
  const key = mutationKey(request);
  return call(request, ids, (context) => run({
    ...context,
    mutation: {
      tx: context.tx, key, body, operation, uid: context.identity.uid, target: ids, now: context.now,
    },
  }));
}

function withBody<K extends WithBody>(
  path: string, method: "POST" | "PUT", operation: K, status: number,
  run: (context: Mutation, body: ReturnType<Contract[K]["body"]["parse"]>) => Promise<unknown> | unknown,
): Route {
  return {
    method, match: match(path), operation, status,
    execute: async (request, ids) => {
      rejectQuery(request);
      type Body = ReturnType<Contract[K]["body"]["parse"]>;
      const body = input(apiContracts[operation].body, await jsonBody(request)) as Body;
      return mutate(request, ids, operation, body, (context) => run(context, body));
    },
  };
}

function emptyMutation(
  path: string, operation: ApiOperation, run: (context: Mutation) => Promise<unknown> | unknown,
): Route {
  return {
    method: "POST", match: match(path), operation,
    execute: async (request, ids) => {
      rejectQuery(request);
      if ((await readBytes(request, 32_768)).length) {
        throw new HttpError("INVALID_INPUT", "This route does not accept a request body.");
      }
      return mutate(request, ids, operation, undefined, run);
    },
  };
}

async function change(
  context: Mutation, requirement: Permission | "patient",
  run: (scope: CircleAccess) => Promise<unknown> | unknown,
) {
  const scope = await scoped(context, requirement);
  return once(context.mutation, scope.ref.collection("idempotencyKeys"), async () => run(scope));
}

const routes: Route[] = [
  list("circles", "listCircles", (c, query) => circles.listCircles(c.tx, c.db, c.identity.uid, query)),
  withBody("circles", "POST", "createCircle", 201, (c, body) => circles.createCircle(c.mutation, c.db, body)),
  withBody("invitations/accept", "POST", "acceptInvitation", 200, (c, body) => circles.acceptInvitation(c.mutation, c.db, c.identity, body)),
  read(circle, "getCircle", "care:read", (_, scope) => circles.getCircle(scope)),
  withBody(circle, "PUT", "updateCircle", 200, (c, body) => change(c, "patient", (scope) => circles.updateCircle(c.mutation, scope, body))),
  list(`${circle}/invitations`, "listInvitations", async (c, query) =>
    circles.listInvitations(c.tx, c.db, await scoped(c, "patient"), query, c.now)),
  withBody(`${circle}/invitations`, "POST", "createInvitation", 201, (c, body) =>
    change(c, "patient", (scope) => {
      if (!c.identity.email_verified) throw new HttpError("FORBIDDEN", "Verify your email before sending invitations.");
      return circles.createInvitation(c.mutation, c.db, scope, body);
    })),
  emptyMutation(`${circle}/invitations/${id}/revoke`, "revokeInvitation", (c) =>
    change(c, "patient", (scope) => circles.revokeInvitation(c.mutation, c.db, scope, input(idSchema, c.ids[1])))),
  list(`${circle}/members`, "listMemberships", async (c, query) =>
    circles.listMemberships(c.tx, await scoped(c, "patient"), query)),
  emptyMutation(`${circle}/members/${id}/revoke`, "revokeMembership", (c) =>
    change(c, "patient", (scope) => circles.revokeMembership(c.mutation, c.db, scope, input(idSchema, c.ids[1])))),
  read(`${circle}/escalation-assignee`, "getEscalationAssignee", "patient", (_, scope) =>
    ({ caregiverUid: scope.circle.defaultCaregiverUid ?? null })),
  withBody(`${circle}/escalation-assignee`, "PUT", "setEscalationAssignee", 200, (c, body) =>
    change(c, "patient", (scope) => circles.setAssignee(c.mutation, c.db, scope, body))),
  list(`${circle}/medications`, "listMedications", async (c, query) =>
    meds.listMedications(c.tx, await scoped(c, "care:read"), query)),
  withBody(`${circle}/medications`, "POST", "createMedication", 201, (c, body) =>
    change(c, "patient", (scope) => meds.changeMedication(c.mutation, scope, undefined, body))),
  withBody(`${circle}/medications/${id}`, "PUT", "updateMedication", 200, (c, body) =>
    change(c, "patient", (scope) => meds.changeMedication(c.mutation, scope, input(idSchema, c.ids[1]), body))),
  emptyMutation(`${circle}/medications/${id}/archive`, "archiveMedication", (c) =>
    change(c, "patient", (scope) => meds.changeMedication(c.mutation, scope, input(idSchema, c.ids[1])))),
  list(`${circle}/schedules`, "listSchedules", async (c, query) =>
    meds.listSchedules(c.tx, await scoped(c, "care:read"), query)),
  withBody(`${circle}/schedules`, "POST", "createSchedule", 201, (c, body) =>
    change(c, "patient", (scope) => meds.createSchedule(c.mutation, scope, body))),
  emptyMutation(`${circle}/schedules/${id}/end`, "endSchedule", (c) =>
    change(c, "patient", (scope) => meds.endSchedule(c.mutation, scope, input(idSchema, c.ids[1])))),
  list(`${circle}/doses`, "listDoses", async (c, query) =>
    meds.listDoses(c.tx, await scoped(c, "care:read"), query)),
  read(`${circle}/doses/${id}`, "getDose", "care:read", (c, scope) => meds.getDose(c.tx, scope, input(idSchema, c.ids[1]))),
  withBody(`${circle}/doses/${id}/reports`, "POST", "reportDose", 200, async (c, body) => {
    const scope = await scoped(c, "care:read");
    meds.assertDoseActor(scope, body);
    return once(c.mutation, scope.ref.collection("idempotencyKeys"), () =>
      meds.reportDose(c.mutation, scope, input(idSchema, c.ids[1]), body));
  }),
  list(`${circle}/appointments`, "listAppointments", async (c, query) =>
    care.listAppointments(c.tx, await scoped(c, "care:read"), query, c.now)),
  withBody(`${circle}/appointments`, "POST", "createAppointment", 201, (c, body) =>
    change(c, "patient", (scope) => care.changeAppointment(c.mutation, scope, undefined, body))),
  withBody(`${circle}/appointments/${id}`, "PUT", "updateAppointment", 200, (c, body) =>
    change(c, "patient", (scope) => care.changeAppointment(c.mutation, scope, input(idSchema, c.ids[1]), body))),
  emptyMutation(`${circle}/appointments/${id}/cancel`, "cancelAppointment", (c) =>
    change(c, "patient", (scope) => care.changeAppointment(c.mutation, scope, input(idSchema, c.ids[1])))),
  list(`${circle}/escalations`, "listEscalations", async (c, query) =>
    care.listEscalations(c.tx, await scoped(c, "care:read"), query)),
  emptyMutation(`${circle}/escalations/${id}/claim`, "claimEscalation", (c) =>
    change(c, "escalation:respond", (scope) => care.claimTask(c.mutation, scope, input(idSchema, c.ids[1])))),
  withBody(`${circle}/escalations/${id}/resolve`, "POST", "resolveEscalation", 200, (c, body) =>
    change(c, "escalation:respond", (scope) => care.resolveTask(c.mutation, scope, input(idSchema, c.ids[1]), body))),
  list(`${circle}/insights`, "getInsights", async (c, query) =>
    care.getInsights(c.tx, await scoped(c, "insights:read"), query)),
  list(`${circle}/audit-events`, "listAudit", async (c, query) =>
    care.listAudit(c.tx, await scoped(c, "patient"), query)),
  {
    method: "POST", match: match(`${circle}/prescription-extractions`), operation: "createExtraction", status: 201,
    execute: async (request, ids) => {
      rejectQuery(request);
      const identity = await authenticate(request);
      return ai.createExtraction(getAdminFirestore(), identity.uid, input(idSchema, ids[0]), mutationKey(request), request);
    },
  },
  read(`${circle}/prescription-extractions/${id}`, "getExtraction", "patient", (c, scope) =>
    ai.getExtraction(c.tx, scope, input(idSchema, c.ids[1]))),
  withBody(`${circle}/prescription-extractions/${id}/review`, "POST", "reviewExtraction", 200, (c, body) =>
    change(c, "patient", (scope) => ai.reviewExtraction(c.mutation, scope, input(idSchema, c.ids[1]), body))),
];

export async function dispatch(request: Request, segments: string[]) {
  let operation: ApiOperation | undefined;
  try {
    const path = segments.join("/");
    for (const route of routes) {
      const matched = route.method === request.method && path.match(route.match);
      if (!matched) continue;
      operation = route.operation;
      const data = await route.execute(request, matched.slice(1));
      return answer(apiContracts[operation].response.parse({ data }), route.status);
    }
    return notFound();
  } catch (error) {
    return failure(error, operation);
  }
}
