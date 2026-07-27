import {
  ingestTrackBatchInputSchema,
  startTrackingSessionInputSchema,
  stopTrackingSessionInputSchema,
  type TrackPoint,
  type TrackingRole,
} from "./domain.js";
import { getDatabase } from "firebase-admin/database";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import {
  db,
  membershipId,
  parseInput,
  requireAuth,
  requireEventOperator,
} from "./callable.js";
import { adminApp, CALLABLE_OPTIONS } from "./config.js";
import { syncEventAccessForMember } from "./event-access.js";

const realtime = getDatabase(adminApp);

function isTrackingRole(value: unknown): value is TrackingRole {
  return value === "pilot" || value === "retriever";
}

function activeTrackingId(eventId: string, userId: string) {
  return membershipId(eventId, userId);
}

function assertPointTimes(points: TrackPoint[]) {
  const latestAllowed = Date.now() + 5 * 60 * 1_000;
  if (points.some((point) => point.recordedAt > latestAllowed)) {
    throw new HttpsError(
      "invalid-argument",
      "Track points cannot be more than five minutes in the future.",
    );
  }
}

export const startTrackingSession = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const actor = requireAuth(request);
    const input = parseInput(startTrackingSessionInputSchema, request.data);
    const memberReference = db.doc(
      `eventMemberships/${membershipId(input.eventId, actor.uid)}`,
    );
    const eventReference = db.doc(`events/${input.eventId}`);
    const activeReference = db.doc(
      `trackingActives/${activeTrackingId(input.eventId, actor.uid)}`,
    );
    const candidateReference = db.collection("trackingSessions").doc();

    const result = await db.runTransaction(async (transaction) => {
      const [memberSnapshot, eventSnapshot, activeSnapshot] = await Promise.all([
        transaction.get(memberReference),
        transaction.get(eventReference),
        transaction.get(activeReference),
      ]);
      if (!memberSnapshot.exists || memberSnapshot.data()?.status !== "approved") {
        throw new HttpsError(
          "permission-denied",
          "An approved event membership is required.",
        );
      }
      const membership = memberSnapshot.data()!;
      if (!isTrackingRole(membership.role)) {
        throw new HttpsError(
          "failed-precondition",
          "Only pilots and retrievers can start tracking.",
        );
      }
      if (!eventSnapshot.exists || !["published", "active"].includes(eventSnapshot.data()?.status)) {
        throw new HttpsError(
          "failed-precondition",
          "Tracking is not available for this event.",
        );
      }

      if (activeSnapshot.exists) {
        const existingSessionId = String(activeSnapshot.data()?.sessionId ?? "");
        if (existingSessionId) {
          const existingSession = await transaction.get(
            db.doc(`trackingSessions/${existingSessionId}`),
          );
          if (existingSession.data()?.status === "active") {
            return {
              sessionId: existingSessionId,
              role: membership.role as TrackingRole,
              resumed: true,
            };
          }
        }
      }

      const session = {
        id: candidateReference.id,
        eventId: input.eventId,
        eventName: eventSnapshot.data()?.name,
        userId: actor.uid,
        displayName: membership.displayName,
        radioCallsign: membership.radioCallsign ?? null,
        role: membership.role,
        status: "active",
        deviceId: input.deviceId,
        startedAt: FieldValue.serverTimestamp(),
        stoppedAt: null,
        pointCount: 0,
        latestPoint: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      transaction.create(candidateReference, session);
      transaction.set(activeReference, {
        eventId: input.eventId,
        userId: actor.uid,
        sessionId: candidateReference.id,
        role: membership.role,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(db.collection("auditLogs").doc(), {
        eventId: input.eventId,
        actorId: actor.uid,
        action: "tracking.started",
        targetId: candidateReference.id,
        createdAt: FieldValue.serverTimestamp(),
      });
      return {
        sessionId: candidateReference.id,
        role: membership.role as TrackingRole,
        resumed: false,
      };
    });

    await syncEventAccessForMember(input.eventId, actor.uid);
    return result;
  },
);

export const ingestTrackBatch = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const actor = requireAuth(request);
    const input = parseInput(ingestTrackBatchInputSchema, request.data);
    assertPointTimes(input.points);
    const sessionReference = db.doc(`trackingSessions/${input.sessionId}`);
    const chunkReference = sessionReference.collection("chunks").doc(input.batchId);
    const lastPoint = input.points.at(-1)!;

    const result = await db.runTransaction(async (transaction) => {
      const [sessionSnapshot, chunkSnapshot] = await Promise.all([
        transaction.get(sessionReference),
        transaction.get(chunkReference),
      ]);
      if (!sessionSnapshot.exists) {
        throw new HttpsError("not-found", "Tracking session not found.");
      }
      const session = sessionSnapshot.data()!;
      if (session.userId !== actor.uid || session.eventId !== input.eventId) {
        throw new HttpsError("permission-denied", "This tracking session is not yours.");
      }
      if (session.status !== "active") {
        throw new HttpsError("failed-precondition", "Tracking session is not active.");
      }
      if (chunkSnapshot.exists) {
        return { accepted: chunkSnapshot.data()?.pointCount ?? 0, duplicate: true };
      }

      transaction.create(chunkReference, {
        id: input.batchId,
        batchId: input.batchId,
        sessionId: input.sessionId,
        eventId: input.eventId,
        userId: actor.uid,
        firstRecordedAt: input.points[0]!.recordedAt,
        lastRecordedAt: lastPoint.recordedAt,
        pointCount: input.points.length,
        points: input.points,
        createdAt: FieldValue.serverTimestamp(),
      });
      const currentLatest = session.latestPoint as TrackPoint | null | undefined;
      const changes: Record<string, unknown> = {
        pointCount: FieldValue.increment(input.points.length),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (!currentLatest || lastPoint.recordedAt >= currentLatest.recordedAt) {
        changes.latestPoint = lastPoint;
        changes.lastRecordedAt = lastPoint.recordedAt;
      }
      transaction.update(sessionReference, changes);
      return { accepted: input.points.length, duplicate: false };
    });
    return result;
  },
);

export const stopTrackingSession = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const actor = requireAuth(request);
    const input = parseInput(stopTrackingSessionInputSchema, request.data);
    const sessionReference = db.doc(`trackingSessions/${input.sessionId}`);
    const initial = await sessionReference.get();
    if (!initial.exists) throw new HttpsError("not-found", "Tracking session not found.");
    const initialData = initial.data()!;
    if (initialData.eventId !== input.eventId) {
      throw new HttpsError("invalid-argument", "Event and session do not match.");
    }
    const isOwner = initialData.userId === actor.uid;
    if (!isOwner && actor.token.superadmin !== true) {
      await requireEventOperator(actor.uid, input.eventId);
    }

    const activeReference = db.doc(
      `trackingActives/${activeTrackingId(input.eventId, initialData.userId)}`,
    );
    await db.runTransaction(async (transaction) => {
      const [sessionSnapshot, activeSnapshot] = await Promise.all([
        transaction.get(sessionReference),
        transaction.get(activeReference),
      ]);
      if (!sessionSnapshot.exists) return;
      if (sessionSnapshot.data()?.status === "active") {
        transaction.update(sessionReference, {
          status: input.outcome,
          stoppedAt: FieldValue.serverTimestamp(),
          stoppedBy: actor.uid,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      if (activeSnapshot.data()?.sessionId === input.sessionId) {
        transaction.delete(activeReference);
      }
      transaction.create(db.collection("auditLogs").doc(), {
        eventId: input.eventId,
        actorId: actor.uid,
        action: `tracking.${input.outcome}`,
        targetId: input.sessionId,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    const liveReference = realtime.ref(
      `live/${input.eventId}/${initialData.userId}`,
    );
    await liveReference.transaction((current) =>
      current?.sessionId === input.sessionId ? null : current,
    );
    return { sessionId: input.sessionId, status: input.outcome };
  },
);
