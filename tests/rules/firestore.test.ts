import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertFails, initializeTestEnvironment, type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { readFile } from "node:fs/promises";

describe("Firestore client access", () => {
  let environment: RulesTestEnvironment;
  const profilePath = "circles/circle-1";
  const memberPath = `${profilePath}/members/patient-1`;

  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080") {
      throw new Error("Run npm run test:rules against the local Firestore emulator");
    }
    environment = await initializeTestEnvironment({
      projectId: "demo-saathi",
      firestore: { rules: await readFile("firestore.rules", "utf8") },
    });
    await environment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      const setup = writeBatch(firestore);
      setup.set(doc(firestore, profilePath), { patientUid: "patient-1" });
      setup.set(doc(firestore, memberPath), { uid: "patient-1", state: "active", role: "patient" });
      await setup.commit();
      expect((await getDoc(doc(firestore, profilePath))).exists()).toBe(true);
    });
  }, 45_000);

  afterAll(async () => {
    await environment?.cleanup();
  });

  it("rejects unauthenticated reads and queries", async () => {
    const firestore = environment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(firestore, profilePath)));
    await assertFails(getDocs(collection(firestore, "circles")));
  });

  it("rejects direct reads and writes even for the patient owner", async () => {
    const firestore = environment.authenticatedContext("patient-1").firestore();
    await assertFails(getDoc(doc(firestore, memberPath)));
    await assertFails(setDoc(doc(firestore, profilePath), { patientUid: "other" }));
  });
});
