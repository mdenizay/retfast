import { getFunctions } from "firebase-admin/functions";
import { getDatabase } from "firebase-admin/database";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onTaskDispatched } from "firebase-functions/v2/tasks";

import {
  db,
  membershipId,
  parseInput,
  requireAuth,
  requireEventOperator,
} from "./callable.js";
import { adminApp, CALLABLE_OPTIONS, REGION } from "./config.js";
import {
  configureRetrieverInputSchema,
  managerAssignRetrievalInputSchema,
  managerDispatchRetrievalInputSchema,
  nearbyRetrieversInputSchema,
  requestRetrievalInputSchema,
  respondRetrievalInputSchema,
  updateRetrievalInputSchema,
} from "./domain.js";
import { sendPushToUser } from "./notifications.js";
import {
  canTransitionRetrieval,
  haversineKilometres,
  type RetrievalStatus,
} from "./retrieval-state.js";

const OFFER_SECONDS = 45;
const LIVE_STALE_MILLISECONDS = 3 * 60 * 1_000;
const realtime = getDatabase(adminApp);

type LiveLocation = {
  userId?: string;
  role?: string;
  displayName?: string;
  latitude?: number;
  longitude?: number;
  recordedAt?: number;
  online?: boolean;
};

type RetrieverState = {
  eventId?: string;
  userId?: string;
  displayName?: string;
  capacity?: number;
  assignedCount?: number;
  availability?: string;
  busyReason?: string | null;
};

function stateId(eventId: string, userId: string) {
  return membershipId(eventId, userId);
}

async function approvedMember(eventId: string, userId: string) {
  const snapshot = await db.doc(
    `eventMemberships/${membershipId(eventId, userId)}`,
  ).get();
  if (!snapshot.exists || snapshot.data()?.status !== "approved") {
    throw new HttpsError(
      "permission-denied",
      "An approved event membership is required.",
    );
  }
  return snapshot.data()!;
}

function assertRole(member: Record<string, unknown>, role: string) {
  if (member.role !== role) {
    throw new HttpsError(
      "permission-denied",
      `The ${role} event role is required.`,
    );
  }
}

function isFreshLive(location: LiveLocation | undefined, role: string) {
  return Boolean(
    location?.role === role &&
      location.online === true &&
      typeof location.latitude === "number" &&
      typeof location.longitude === "number" &&
      typeof location.recordedAt === "number" &&
      Date.now() - location.recordedAt <= LIVE_STALE_MILLISECONDS,
  );
}

async function eventLive(eventId: string) {
  const snapshot = await realtime.ref(`live/${eventId}`).get();
  return (snapshot.val() ?? {}) as Record<string, LiveLocation>;
}

function availableSeat(state: RetrieverState) {
  const capacity = Number(state.capacity ?? 0);
  const assignedCount = Number(state.assignedCount ?? 0);
  return state.availability === "available" && assignedCount < capacity;
}

function reserveSeat(state: RetrieverState) {
  if (!availableSeat(state)) {
    throw new HttpsError(
      "resource-exhausted",
      "The retriever is no longer available or has reached capacity.",
    );
  }
  const capacity = Number(state.capacity);
  const assignedCount = Number(state.assignedCount ?? 0) + 1;
  return {
    assignedCount,
    availability: assignedCount >= capacity ? "busy" : "available",
    busyReason: assignedCount >= capacity ? "full" : null,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function releaseSeat(state: RetrieverState) {
  const capacity = Number(state.capacity ?? 1);
  const assignedCount = Math.max(0, Number(state.assignedCount ?? 0) - 1);
  const reopen = state.busyReason === "full" && assignedCount < capacity;
  return {
    assignedCount,
    availability: reopen ? "available" : state.availability,
    busyReason: reopen ? null : (state.busyReason ?? null),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export const configureRetriever = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const actor = requireAuth(request);
    const input = parseInput(configureRetrieverInputSchema, request.data);
    const member = await approvedMember(input.eventId, actor.uid);
    assertRole(member, "retriever");
    const reference = db.doc(
      `retrieverStates/${stateId(input.eventId, actor.uid)}`,
    );
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const assignedCount = Number(snapshot.data()?.assignedCount ?? 0);
      if (input.capacity < assignedCount) {
        throw new HttpsError(
          "failed-precondition",
          "Capacity cannot be lower than currently assigned pilots.",
        );
      }
      const full = assignedCount >= input.capacity;
      transaction.set(
        reference,
        {
          id: reference.id,
          eventId: input.eventId,
          userId: actor.uid,
          displayName: member.displayName,
          radioCallsign: member.radioCallsign ?? null,
          capacity: input.capacity,
          assignedCount,
          availability: full ? "busy" : input.availability,
          busyReason: full
            ? "full"
            : input.availability === "busy"
              ? "manual"
              : null,
          createdAt: snapshot.exists
            ? (snapshot.data()?.createdAt ?? FieldValue.serverTimestamp())
            : FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
    return { configured: true };
  },
);

export const listNearbyRetrievers = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const actor = requireAuth(request);
    const input = parseInput(nearbyRetrieversInputSchema, request.data);
    const member = await approvedMember(input.eventId, actor.uid);
    assertRole(member, "pilot");
    const session = await db.doc(`trackingSessions/${input.sessionId}`).get();
    if (
      !session.exists ||
      session.data()?.eventId !== input.eventId ||
      session.data()?.userId !== actor.uid ||
      session.data()?.status !== "active"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "An active pilot tracking session is required.",
      );
    }
    const [live, states] = await Promise.all([
      eventLive(input.eventId),
      db.collection("retrieverStates")
        .where("eventId", "==", input.eventId)
        .limit(100)
        .get(),
    ]);
    const pilotLocation = live[actor.uid];
    if (!isFreshLive(pilotLocation, "pilot")) {
      throw new HttpsError(
        "failed-precondition",
        "A recent pilot location is required to find retrievers.",
      );
    }
    return {
      retrievers: states.docs
        .map((snapshot) => snapshot.data() as RetrieverState)
        .filter((state) => availableSeat(state))
        .flatMap((state) => {
          const location = state.userId ? live[state.userId] : undefined;
          if (!state.userId || !isFreshLive(location, "retriever")) return [];
          return [{
            userId: state.userId,
            displayName: state.displayName ?? location?.displayName ?? "Retriever",
            capacity: Number(state.capacity ?? 0),
            assignedCount: Number(state.assignedCount ?? 0),
            latitude: location!.latitude!,
            longitude: location!.longitude!,
            distanceKm: haversineKilometres(
              {
                latitude: pilotLocation!.latitude!,
                longitude: pilotLocation!.longitude!,
              },
              {
                latitude: location!.latitude!,
                longitude: location!.longitude!,
              },
            ),
          }];
        })
        .sort((left, right) => left.distanceKm - right.distanceKm)
        .slice(0, 8),
    };
  },
);

type OfferExpiryTask = {
  eventId: string;
  jobId: string;
  offerVersion: string;
};

export const expireRetrievalOffer = onTaskDispatched<OfferExpiryTask>(
  {
    memory: "256MiB",
    minInstances: 0,
    maxInstances: 1,
    concurrency: 1,
    timeoutSeconds: 30,
    retryConfig: {
      maxAttempts: 3,
      maxRetrySeconds: 300,
      minBackoffSeconds: 10,
      maxBackoffSeconds: 60,
    },
    rateLimits: {
      maxConcurrentDispatches: 1,
      maxDispatchesPerSecond: 2,
    },
  },
  async (request) => {
    const { eventId, jobId, offerVersion } = request.data;
    const reference = db.doc(`retrievalJobs/${jobId}`);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (
        snapshot.data()?.eventId !== eventId ||
        snapshot.data()?.status !== "offered" ||
        snapshot.data()?.offerVersion !== offerVersion
      ) return;
      transaction.update(reference, {
        status: "searching",
        offeredRetrieverId: null,
        offeredRetrieverName: null,
        offerExpiresAt: null,
        offerVersion: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  },
);

async function enqueueOfferExpiry(
  eventId: string,
  jobId: string,
  offerVersion: string,
  expiresAt: Date,
) {
  try {
    const queue = getFunctions(adminApp).taskQueue<OfferExpiryTask>(
      `locations/${REGION}/functions/expireRetrievalOffer`,
    );
    await queue.enqueue(
      { eventId, jobId, offerVersion },
      { scheduleTime: expiresAt, dispatchDeadlineSeconds: 30 },
    );
    return true;
  } catch (error) {
    logger.warn("Retrieval expiry task could not be queued", {
      error,
      eventId,
      jobId,
    });
    return false;
  }
}

export const requestRetrieval = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const actor = requireAuth(request);
    const input = parseInput(requestRetrievalInputSchema, request.data);
    const member = await approvedMember(input.eventId, actor.uid);
    assertRole(member, "pilot");
    const live = await eventLive(input.eventId);
    const pilotLocation = live[actor.uid];
    const retrieverLocation = live[input.retrieverId];
    if (!isFreshLive(pilotLocation, "pilot")) {
      throw new HttpsError("failed-precondition", "Pilot location is unavailable.");
    }
    if (!isFreshLive(retrieverLocation, "retriever")) {
      throw new HttpsError("failed-precondition", "Retriever location is unavailable.");
    }
    const jobReference = db.doc(`retrievalJobs/${input.sessionId}`);
    const stateReference = db.doc(
      `retrieverStates/${stateId(input.eventId, input.retrieverId)}`,
    );
    const sessionReference = db.doc(`trackingSessions/${input.sessionId}`);
    const now = Date.now();
    const expiresAt = new Date(now + OFFER_SECONDS * 1_000);
    const offerVersion = `${now}-${input.retrieverId}`;
    const outcome = await db.runTransaction(async (transaction) => {
      const [session, state, existing] = await Promise.all([
        transaction.get(sessionReference),
        transaction.get(stateReference),
        transaction.get(jobReference),
      ]);
      if (
        !session.exists ||
        session.data()?.eventId !== input.eventId ||
        session.data()?.userId !== actor.uid ||
        session.data()?.status !== "active"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "An active pilot tracking session is required.",
        );
      }
      const currentStatus = existing.data()?.status as RetrievalStatus | undefined;
      if (["assigned", "picked_up"].includes(currentStatus ?? "")) {
        return { created: false, active: true };
      }
      if (["delivered", "cancelled"].includes(currentStatus ?? "")) {
        throw new HttpsError(
          "failed-precondition",
          "This tracking session already has a closed retrieval.",
        );
      }
      if (!state.exists || !availableSeat(state.data() as RetrieverState)) {
        throw new HttpsError(
          "resource-exhausted",
          "The selected retriever is no longer available.",
        );
      }
      const currentExpiry = existing.data()?.offerExpiresAt as Timestamp | undefined;
      if (
        currentStatus === "offered" &&
        (currentExpiry?.toMillis() ?? 0) > now
      ) {
        if (existing.data()?.offeredRetrieverId === input.retrieverId) {
          return { created: false, active: true };
        }
        throw new HttpsError(
          "failed-precondition",
          "Wait for the current retriever offer to finish.",
        );
      }
      transaction.set(jobReference, {
        id: jobReference.id,
        eventId: input.eventId,
        sessionId: input.sessionId,
        pilotId: actor.uid,
        pilotName: member.displayName,
        pilotRadioCallsign: member.radioCallsign ?? null,
        urgency: input.urgency,
        status: "offered",
        landing: {
          latitude: pilotLocation!.latitude,
          longitude: pilotLocation!.longitude,
          recordedAt: pilotLocation!.recordedAt,
        },
        offeredRetrieverId: input.retrieverId,
        offeredRetrieverName: state.data()?.displayName ?? "Retriever",
        assignedRetrieverId: null,
        assignedRetrieverName: null,
        seatReserved: false,
        offerExpiresAt: Timestamp.fromDate(expiresAt),
        offerVersion,
        distanceKm: haversineKilometres(
          {
            latitude: pilotLocation!.latitude!,
            longitude: pilotLocation!.longitude!,
          },
          {
            latitude: retrieverLocation!.latitude!,
            longitude: retrieverLocation!.longitude!,
          },
        ),
        requestedAt: existing.exists
          ? (existing.data()?.requestedAt ?? FieldValue.serverTimestamp())
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.create(db.collection("auditLogs").doc(), {
        eventId: input.eventId,
        actorId: actor.uid,
        action: `retrieval.${input.urgency === "emergency" ? "emergency_" : ""}offered`,
        targetId: jobReference.id,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { created: true, active: true };
    });
    if (outcome.created) {
      const [expiryQueued] = await Promise.all([
        enqueueOfferExpiry(
          input.eventId,
          jobReference.id,
          offerVersion,
          expiresAt,
        ),
        sendPushToUser(input.retrieverId, {
          title: input.urgency === "emergency"
            ? "RETFAST · Emergency retrieval"
            : "RETFAST · New pilot request",
          body: `${member.displayName} is waiting for pickup.`,
          data: {
            type: "retrieval-offer",
            eventId: input.eventId,
            jobId: jobReference.id,
          },
        }),
      ]);
      return { jobId: jobReference.id, expiryQueued };
    }
    return { jobId: jobReference.id, expiryQueued: true };
  },
);

export const respondRetrievalOffer = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const actor = requireAuth(request);
    const input = parseInput(respondRetrievalInputSchema, request.data);
    const member = await approvedMember(input.eventId, actor.uid);
    assertRole(member, "retriever");
    const jobReference = db.doc(`retrievalJobs/${input.jobId}`);
    const stateReference = db.doc(
      `retrieverStates/${stateId(input.eventId, actor.uid)}`,
    );
    const result = await db.runTransaction(async (transaction) => {
      const [job, state] = await Promise.all([
        transaction.get(jobReference),
        transaction.get(stateReference),
      ]);
      if (!job.exists || job.data()?.eventId !== input.eventId) {
        throw new HttpsError("not-found", "Retrieval request not found.");
      }
      if (
        job.data()?.status !== "offered" ||
        job.data()?.offeredRetrieverId !== actor.uid
      ) {
        throw new HttpsError(
          "failed-precondition",
          "This offer is no longer active.",
        );
      }
      const expiresAt = job.data()?.offerExpiresAt as Timestamp | undefined;
      const expired = !expiresAt || expiresAt.toMillis() <= Date.now();
      if (!input.accept || expired) {
        transaction.update(jobReference, {
          status: "searching",
          offeredRetrieverId: null,
          offeredRetrieverName: null,
          offerExpiresAt: null,
          offerVersion: null,
          declinedRetrieverIds: FieldValue.arrayUnion(actor.uid),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return {
          accepted: false,
          pilotId: String(job.data()?.pilotId ?? ""),
        };
      }
      if (!state.exists) {
        throw new HttpsError(
          "failed-precondition",
          "Configure your retriever capacity before accepting requests.",
        );
      }
      transaction.update(stateReference, reserveSeat(state.data() as RetrieverState));
      transaction.update(jobReference, {
        status: "assigned",
        offeredRetrieverId: null,
        offeredRetrieverName: null,
        assignedRetrieverId: actor.uid,
        assignedRetrieverName: member.displayName,
        seatReserved: true,
        assignedAt: FieldValue.serverTimestamp(),
        offerExpiresAt: null,
        offerVersion: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(db.collection("auditLogs").doc(), {
        eventId: input.eventId,
        actorId: actor.uid,
        action: "retrieval.accepted",
        targetId: input.jobId,
        createdAt: FieldValue.serverTimestamp(),
      });
      return {
        accepted: true,
        pilotId: String(job.data()?.pilotId ?? ""),
      };
    });
    if (result.accepted && result.pilotId) {
      await sendPushToUser(result.pilotId, {
        title: "RETFAST · Retriever assigned",
        body: `${member.displayName} accepted your pickup request.`,
        data: {
          type: "retrieval-assigned",
          eventId: input.eventId,
          jobId: input.jobId,
        },
      });
    }
    return { jobId: input.jobId, accepted: result.accepted };
  },
);

export const updateRetrievalProgress = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const actor = requireAuth(request);
    const input = parseInput(updateRetrievalInputSchema, request.data);
    const initial = await db.doc(`retrievalJobs/${input.jobId}`).get();
    if (!initial.exists || initial.data()?.eventId !== input.eventId) {
      throw new HttpsError("not-found", "Retrieval request not found.");
    }
    const isAssignedRetriever = initial.data()?.assignedRetrieverId === actor.uid;
    const isPilotCancellation =
      input.action === "cancelled" &&
      initial.data()?.pilotId === actor.uid &&
      ["searching", "offered", "assigned"].includes(initial.data()?.status);
    if (
      !isAssignedRetriever &&
      !isPilotCancellation &&
      actor.token.superadmin !== true
    ) {
      await requireEventOperator(actor.uid, input.eventId);
    }
    const jobReference = initial.ref;
    const result = await db.runTransaction(async (transaction) => {
      const job = await transaction.get(jobReference);
      if (!job.exists) throw new HttpsError("not-found", "Retrieval request not found.");
      const current = job.data()?.status as RetrievalStatus;
      if (!canTransitionRetrieval(current, input.action)) {
        throw new HttpsError(
          "failed-precondition",
          `Retrieval cannot move from ${current} to ${input.action}.`,
        );
      }
      const retrieverId = String(job.data()?.assignedRetrieverId ?? "");
      const stateReference = retrieverId
        ? db.doc(`retrieverStates/${stateId(input.eventId, retrieverId)}`)
        : null;
      const state = stateReference
        ? await transaction.get(stateReference)
        : null;
      if (
        ["delivered", "cancelled"].includes(input.action) &&
        job.data()?.seatReserved === true &&
        stateReference &&
        state?.exists
      ) {
        transaction.update(
          stateReference,
          releaseSeat(state.data() as RetrieverState),
        );
      }
      transaction.update(jobReference, {
        status: input.action,
        seatReserved: ["delivered", "cancelled"].includes(input.action)
          ? false
          : job.data()?.seatReserved,
        [`${input.action}At`]: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(db.collection("auditLogs").doc(), {
        eventId: input.eventId,
        actorId: actor.uid,
        action: `retrieval.${input.action}`,
        targetId: input.jobId,
        createdAt: FieldValue.serverTimestamp(),
      });
      return {
        pilotId: String(job.data()?.pilotId ?? ""),
        retrieverId,
      };
    });
    const targetId = input.action === "cancelled"
      ? (result.pilotId === actor.uid ? result.retrieverId : result.pilotId)
      : result.pilotId;
    if (targetId) {
      await sendPushToUser(targetId, {
        title: `RETFAST · ${input.action.replace("_", " ")}`,
        body: `Retrieval status changed to ${input.action.replace("_", " ")}.`,
        data: {
          type: "retrieval-update",
          eventId: input.eventId,
          jobId: input.jobId,
        },
      });
    }
    return { jobId: input.jobId, status: input.action };
  },
);

export const managerAssignRetrieval = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const actor = requireAuth(request);
    const input = parseInput(managerAssignRetrievalInputSchema, request.data);
    if (actor.token.superadmin !== true) {
      await requireEventOperator(actor.uid, input.eventId);
    }
    const jobReference = db.doc(`retrievalJobs/${input.jobId}`);
    const targetReference = db.doc(
      `retrieverStates/${stateId(input.eventId, input.retrieverId)}`,
    );
    const result = await db.runTransaction(async (transaction) => {
      const job = await transaction.get(jobReference);
      if (!job.exists || job.data()?.eventId !== input.eventId) {
        throw new HttpsError("not-found", "Retrieval request not found.");
      }
      const status = job.data()?.status as RetrievalStatus;
      if (["delivered", "cancelled"].includes(status)) {
        throw new HttpsError("failed-precondition", "Retrieval is already closed.");
      }
      const target = await transaction.get(targetReference);
      if (!target.exists) {
        throw new HttpsError("failed-precondition", "Retriever is not configured.");
      }
      const previousId = String(job.data()?.assignedRetrieverId ?? "");
      const changingVehicle = previousId !== input.retrieverId;
      const previousReference = changingVehicle && previousId
        ? db.doc(`retrieverStates/${stateId(input.eventId, previousId)}`)
        : null;
      const previous = previousReference
        ? await transaction.get(previousReference)
        : null;
      if (changingVehicle) {
        transaction.update(targetReference, reserveSeat(target.data() as RetrieverState));
        if (job.data()?.seatReserved === true && previousReference && previous?.exists) {
          transaction.update(
            previousReference,
            releaseSeat(previous.data() as RetrieverState),
          );
        }
      }
      transaction.update(jobReference, {
        status: status === "picked_up" ? "picked_up" : "assigned",
        offeredRetrieverId: null,
        offeredRetrieverName: null,
        assignedRetrieverId: input.retrieverId,
        assignedRetrieverName: target.data()?.displayName ?? "Retriever",
        seatReserved: true,
        assignedAt: FieldValue.serverTimestamp(),
        assignedBy: actor.uid,
        offerExpiresAt: null,
        offerVersion: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(db.collection("auditLogs").doc(), {
        eventId: input.eventId,
        actorId: actor.uid,
        action: changingVehicle ? "retrieval.transferred" : "retrieval.assigned",
        targetId: input.jobId,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { pilotId: String(job.data()?.pilotId ?? "") };
    });
    await Promise.all([
      sendPushToUser(input.retrieverId, {
        title: "RETFAST · Retrieval assigned",
        body: "An event manager assigned a pilot to your vehicle.",
        data: {
          type: "retrieval-assigned",
          eventId: input.eventId,
          jobId: input.jobId,
        },
      }),
      result.pilotId
        ? sendPushToUser(result.pilotId, {
            title: "RETFAST · Retriever updated",
            body: "The event manager updated your assigned retriever.",
            data: {
              type: "retrieval-assigned",
              eventId: input.eventId,
              jobId: input.jobId,
            },
          })
        : Promise.resolve(false),
    ]);
    return { jobId: input.jobId, assignedRetrieverId: input.retrieverId };
  },
);

export const managerDispatchRetrieval = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const actor = requireAuth(request);
    const input = parseInput(managerDispatchRetrievalInputSchema, request.data);
    if (actor.token.superadmin !== true) {
      await requireEventOperator(actor.uid, input.eventId);
    }
    const live = await eventLive(input.eventId);
    const sessionReference = db.doc(`trackingSessions/${input.sessionId}`);
    const jobReference = db.doc(`retrievalJobs/${input.sessionId}`);
    const targetReference = db.doc(
      `retrieverStates/${stateId(input.eventId, input.retrieverId)}`,
    );
    const result = await db.runTransaction(async (transaction) => {
      const [session, existing, target] = await Promise.all([
        transaction.get(sessionReference),
        transaction.get(jobReference),
        transaction.get(targetReference),
      ]);
      if (
        !session.exists ||
        session.data()?.eventId !== input.eventId ||
        session.data()?.role !== "pilot" ||
        session.data()?.status !== "active"
      ) {
        throw new HttpsError("not-found", "Active pilot session not found.");
      }
      if (existing.exists && !["searching", "offered"].includes(existing.data()?.status)) {
        throw new HttpsError("already-exists", "Pilot already has a retrieval assignment.");
      }
      if (!target.exists) {
        throw new HttpsError("failed-precondition", "Retriever is not configured.");
      }
      transaction.update(targetReference, reserveSeat(target.data() as RetrieverState));
      const pilotId = String(session.data()?.userId ?? "");
      const pilotLocation = live[pilotId];
      const latest = session.data()?.latestPoint as LiveLocation | null | undefined;
      transaction.set(jobReference, {
        id: jobReference.id,
        eventId: input.eventId,
        sessionId: input.sessionId,
        pilotId,
        pilotName: session.data()?.displayName ?? "Pilot",
        pilotRadioCallsign: session.data()?.radioCallsign ?? null,
        urgency: input.urgency,
        status: "assigned",
        landing: {
          latitude: pilotLocation?.latitude ?? latest?.latitude,
          longitude: pilotLocation?.longitude ?? latest?.longitude,
          recordedAt: pilotLocation?.recordedAt ?? latest?.recordedAt,
        },
        offeredRetrieverId: null,
        offeredRetrieverName: null,
        assignedRetrieverId: input.retrieverId,
        assignedRetrieverName: target.data()?.displayName ?? "Retriever",
        seatReserved: true,
        assignedAt: FieldValue.serverTimestamp(),
        assignedBy: actor.uid,
        requestedAt: existing.exists
          ? (existing.data()?.requestedAt ?? FieldValue.serverTimestamp())
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.create(db.collection("auditLogs").doc(), {
        eventId: input.eventId,
        actorId: actor.uid,
        action: "retrieval.dispatched",
        targetId: jobReference.id,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { pilotId };
    });
    await Promise.all([
      sendPushToUser(input.retrieverId, {
        title: "RETFAST · Retrieval assigned",
        body: "An event manager assigned a pilot to your vehicle.",
        data: {
          type: "retrieval-assigned",
          eventId: input.eventId,
          jobId: input.sessionId,
        },
      }),
      result.pilotId
        ? sendPushToUser(result.pilotId, {
            title: "RETFAST · Retriever assigned",
            body: "The event manager assigned a retriever to you.",
            data: {
              type: "retrieval-assigned",
              eventId: input.eventId,
              jobId: input.sessionId,
            },
          })
        : Promise.resolve(false),
    ]);
    return { jobId: input.sessionId, assignedRetrieverId: input.retrieverId };
  },
);
