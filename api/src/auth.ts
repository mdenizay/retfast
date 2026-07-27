import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import type { RequestHandler } from "express";

import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { ApiError } from "./http/error.js";

const firebaseApp = getApps()[0] ?? initializeApp({
  projectId: config.FIREBASE_PROJECT_ID,
});
const firebaseAuth = getAuth(firebaseApp);

export async function verifyBearerToken(value: string | undefined) {
  if (!value?.startsWith("Bearer ")) {
    throw new ApiError(401, "unauthenticated", "A Firebase ID token is required.");
  }
  try {
    return await firebaseAuth.verifyIdToken(value.slice(7), true);
  } catch {
    throw new ApiError(401, "invalid_token", "The Firebase ID token is invalid or expired.");
  }
}

export const requireAuth: RequestHandler = async (request, _response, next) => {
  try {
    request.auth = await verifyBearerToken(request.headers.authorization);
    next();
  } catch (error) {
    next(error);
  }
};

export async function bootstrapUser(token: DecodedIdToken, locale: "tr" | "en") {
  const email = token.email?.toLowerCase();
  if (!email) throw new ApiError(400, "email_required", "The account must have an email address.");
  const globalRole = config.superadminEmails.has(email) ? "superadmin" : "user";
  const fallbackName = email.split("@")[0] ?? "RETFAST User";
  const displayName = String(token.name ?? fallbackName).trim().slice(0, 80);
  const result = await pool.query(
    `INSERT INTO users (id, email, display_name, locale, global_role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       display_name = EXCLUDED.display_name,
       locale = EXCLUDED.locale,
       global_role = EXCLUDED.global_role,
       updated_at = now()
     RETURNING id, email, display_name AS "displayName", locale,
       global_role AS "globalRole", radio_callsign AS "radioCallsign"`,
    [token.uid, email, displayName.length >= 2 ? displayName : fallbackName, locale, globalRole],
  );
  return result.rows[0];
}
