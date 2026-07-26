import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import type { z } from "zod";

import { adminApp } from "./config.js";

export const db = getFirestore(adminApp);

export function parseInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpsError("invalid-argument", "Invalid command payload.", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export function requireAuth(request: CallableRequest<unknown>) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }
  return request.auth;
}

export function requireSuperadmin(request: CallableRequest<unknown>) {
  const auth = requireAuth(request);
  if (auth.token.superadmin !== true) {
    throw new HttpsError("permission-denied", "Superadmin access is required.");
  }
  return auth;
}

export async function requireEventManager(userId: string, eventId: string) {
  const eventSnapshot = await db.doc(`events/${eventId}`).get();
  if (!eventSnapshot.exists) {
    throw new HttpsError("not-found", "Event not found.");
  }
  const eventData = eventSnapshot.data();
  const managers = Array.isArray(eventData?.managerIds)
    ? (eventData.managerIds as string[])
    : [];
  if (!managers.includes(userId)) {
    throw new HttpsError("permission-denied", "Event manager access is required.");
  }
  return eventSnapshot;
}

export function membershipId(eventId: string, userId: string) {
  return `${eventId}_${userId}`;
}

export function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}
