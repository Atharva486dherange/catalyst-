import "server-only";
import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function getAdminApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const authEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST;

  if (authEmulator || firestoreEmulator || projectId?.startsWith("demo-")) {
    if (!authEmulator || !firestoreEmulator || !projectId?.startsWith("demo-")) {
      throw new Error("Local Firebase requires both emulator hosts and a demo project ID");
    }
    if (process.env.K_SERVICE) {
      throw new Error("A deployed service cannot use local Firebase emulators");
    }
    return getApps().find(({ name }) => name === "saathi-emulator") ??
      initializeApp({ projectId }, "saathi-emulator");
  }
  if (process.env.NODE_ENV === "development") {
    throw new Error("Configure the local Firebase emulators before using Firebase in development");
  }
  return getApps().find(({ name }) => name === "saathi-server") ??
    initializeApp({ credential: applicationDefault(), projectId }, "saathi-server");
}

export const getAdminAuth = () => getAuth(getAdminApp());
export const getAdminFirestore = () => getFirestore(getAdminApp());
