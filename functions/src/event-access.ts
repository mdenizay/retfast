import { getDatabase } from "firebase-admin/database";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { eventIdInputSchema } from "@retfast/domain";

import { db, membershipId, parseInput, requireAuth } from "./callable.js";
import { adminApp, CALLABLE_OPTIONS, REGION } from "./config.js";

type MembershipAccess = {
  status?: unknown;
  role?: unknown;
  displayName?: unknown;
  radioCallsign?: unknown;
};

const realtime = getDatabase(adminApp);

function isApprovedAccess(data: MembershipAccess | undefined) {
  return data?.status === "approved" &&
    ["manager", "pilot", "retriever", "observer"].includes(String(data.role));
}

export async function writeEventAccess(
  eventId: string,
  userId: string,
  data: MembershipAccess | undefined,
) {
  const reference = realtime.ref(`eventAccess/${eventId}/${userId}`);
  if (!isApprovedAccess(data)) {
    await reference.remove();
    return;
  }
  await reference.set({
    status: "approved",
    role: data?.role,
    displayName: data?.displayName ?? "RETFAST User",
    radioCallsign: data?.radioCallsign ?? null,
    updatedAt: Date.now(),
  });
}

export async function syncEventAccessForMember(eventId: string, userId: string) {
  const snapshot = await db.doc(
    `eventMemberships/${membershipId(eventId, userId)}`,
  ).get();
  await writeEventAccess(
    eventId,
    userId,
    snapshot.exists ? snapshot.data() : undefined,
  );
}

export const prepareEventRealtime = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const actor = requireAuth(request);
    const input = parseInput(eventIdInputSchema, request.data);
    const snapshot = await db.doc(
      `eventMemberships/${membershipId(input.eventId, actor.uid)}`,
    ).get();
    if (!snapshot.exists || snapshot.data()?.status !== "approved") {
      throw new HttpsError(
        "permission-denied",
        "An approved event membership is required.",
      );
    }
    await writeEventAccess(input.eventId, actor.uid, snapshot.data());
    return { eventId: input.eventId, role: snapshot.data()?.role };
  },
);

export const syncEventAccess = onDocumentWritten(
  {
    document: "eventMemberships/{membershipId}",
    region: REGION,
    minInstances: 0,
    maxInstances: 1,
    concurrency: 10,
  },
  async (event) => {
    const data = event.data?.after.exists ? event.data.after.data() : undefined;
    const before = event.data?.before.data();
    const eventId = String(data?.eventId ?? before?.eventId ?? "");
    const userId = String(data?.userId ?? before?.userId ?? "");
    if (!eventId || !userId) return;
    await writeEventAccess(eventId, userId, data);
  },
);
