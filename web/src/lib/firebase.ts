import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";

const configurations = {
  development: {
    apiKey: "AIzaSyDz3NDdQf8BhdFk_iimxKeb4eBeC-lk7Ds",
    authDomain: "retfast-3279f.firebaseapp.com",
    projectId: "retfast-3279f",
    storageBucket: "retfast-3279f.firebasestorage.app",
    messagingSenderId: "303883341213",
    appId: "1:303883341213:web:35959589f08fc4aedf7374",
  },
  production: {
    apiKey: "AIzaSyC2RvLWz8ych4j7ldh24qvEO585ZlSi_oI",
    authDomain: "retfast-ab7ca.firebaseapp.com",
    projectId: "retfast-ab7ca",
    storageBucket: "retfast-ab7ca.firebasestorage.app",
    messagingSenderId: "81048089421",
    appId: "1:81048089421:web:6aeb347b39bdd9dd867d04",
    measurementId: "G-RPPFT250PS",
  },
} satisfies Record<string, FirebaseOptions>;

export type FirebaseTarget = keyof typeof configurations;

export const firebaseTarget: FirebaseTarget =
  import.meta.env.VITE_FIREBASE_TARGET === "production"
    ? "production"
    : "development";

const app = getApps().length ? getApp() : initializeApp(configurations[firebaseTarget]);

export const auth: Auth = getAuth(app);

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
  emulatorState.__retfastEmulatorsConnected = true;
}
