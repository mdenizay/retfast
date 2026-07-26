import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";

initializeApp();

setGlobalOptions({
  region: "europe-west1",
  maxInstances: 3,
  memory: "256MiB",
});

// Trusted callable commands are introduced with their owning product phase.
// Keeping this entry point deployable lets the Emulator Suite validate the
// Firebase runtime before any paid service is used.
