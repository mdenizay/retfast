import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  type Functions,
} from "firebase/functions";
import {
  connectDatabaseEmulator,
  getDatabase,
  type Database,
} from "firebase/database";

const currentHostname = globalThis.location?.hostname ?? "";
const productionAuthDomain = ["retfast-ab7ca.web.app", "retfast.com"].includes(
  currentHostname,
)
  ? currentHostname
  : "retfast-ab7ca.firebaseapp.com";

const configurations = {
  development: {
    apiKey: "AIzaSyDz3NDdQf8BhdFk_iimxKeb4eBeC-lk7Ds",
    authDomain: "retfast-3279f.firebaseapp.com",
    projectId: "retfast-3279f",
    storageBucket: "retfast-3279f.firebasestorage.app",
    messagingSenderId: "303883341213",
    appId: "1:303883341213:web:35959589f08fc4aedf7374",
    databaseURL:
      "https://retfast-3279f-default-rtdb.europe-west1.firebasedatabase.app",
  },
  production: {
    apiKey: "AIzaSyC2RvLWz8ych4j7ldh24qvEO585ZlSi_oI",
    authDomain: productionAuthDomain,
    projectId: "retfast-ab7ca",
    storageBucket: "retfast-ab7ca.firebasestorage.app",
    messagingSenderId: "81048089421",
    appId: "1:81048089421:web:6aeb347b39bdd9dd867d04",
    measurementId: "G-RPPFT250PS",
    databaseURL:
      "https://retfast-ab7ca-default-rtdb.europe-west1.firebasedatabase.app",
  },
} satisfies Record<string, FirebaseOptions>;

export type FirebaseTarget = keyof typeof configurations;

export const firebaseTarget: FirebaseTarget =
  import.meta.env.VITE_FIREBASE_TARGET === "production"
    ? "production"
    : "development";

const app = getApps().length ? getApp() : initializeApp(configurations[firebaseTarget]);

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const functions: Functions = getFunctions(app, "europe-west1");
export const realtime: Database = getDatabase(app);

const emulatorState = globalThis as typeof globalThis & {
  __retfastEmulatorsConnected?: boolean;
};

if (
  import.meta.env.DEV &&
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true" &&
  !emulatorState.__retfastEmulatorsConnected
) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectDatabaseEmulator(realtime, "127.0.0.1", 9000);
  emulatorState.__retfastEmulatorsConnected = true;
}
