import { getApps, initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";

export const REGION = "europe-west1";
export const SUPERADMIN_EMAIL = "medenizay@gmail.com";
export const CALLABLE_OPTIONS = {
  enforceAppCheck: false,
};

export const adminApp = getApps()[0] ?? initializeApp();

setGlobalOptions({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 3,
  concurrency: 20,
  timeoutSeconds: 30,
});
