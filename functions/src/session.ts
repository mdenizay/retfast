import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { z } from "zod";

import { db, parseInput, requireAuth } from "./callable.js";
import { adminApp, CALLABLE_OPTIONS, SUPERADMIN_EMAIL } from "./config.js";

const bootstrapInputSchema = z.object({
  locale: z.enum(["tr", "en"]).default("tr"),
});

export const bootstrapSession = onCall(CALLABLE_OPTIONS, async (request) => {
  const session = requireAuth(request);
  const input = parseInput(bootstrapInputSchema, request.data ?? {});
  const auth = getAuth(adminApp);
  const authUser = await auth.getUser(session.uid);
  const email = authUser.email?.trim().toLowerCase() ?? "";
  const isSuperadmin =
    email === SUPERADMIN_EMAIL && authUser.emailVerified === true;

  if (isSuperadmin && authUser.customClaims?.superadmin !== true) {
    await auth.setCustomUserClaims(authUser.uid, {
      ...authUser.customClaims,
      superadmin: true,
    });
  }

  const profileReference = db.doc(`users/${authUser.uid}`);
  const profileSnapshot = await profileReference.get();
  const globalRole = isSuperadmin ? "superadmin" : "user";
  const displayName =
    authUser.displayName?.trim() || email.split("@")[0] || "RETFAST User";

  await profileReference.set(
    {
      id: authUser.uid,
      email,
      displayName,
      locale: profileSnapshot.data()?.locale ?? input.locale,
      globalRole,
      radioCallsign: profileSnapshot.data()?.radioCallsign ?? null,
      ...(profileSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    globalRole,
    refreshToken: isSuperadmin && session.token.superadmin !== true,
  };
});
