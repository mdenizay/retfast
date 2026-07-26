import {
  applyToEventInputSchema,
  createEventInputSchema,
  inviteMemberInputSchema,
  reviewMembershipInputSchema,
  setEventManagerInputSchema,
  updateEventInputSchema,
} from "@retfast/domain";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import {
  db,
  membershipId,
  parseInput,
  requireAuth,
  requireEventManager,
  requireSuperadmin,
  slugify,
} from "./callable.js";
import { adminApp } from "./config.js";
import { enqueueLifecycleTasks } from "./task-queue.js";

async function userSummary(user: UserRecord) {
  const profile = await db.doc(`users/${user.uid}`).get();
  return {
    email: user.email?.toLowerCase() ?? "",
    displayName:
      profile.data()?.displayName ??
      user.displayName ??
      user.email?.split("@")[0] ??
      "RETFAST User",
    radioCallsign: profile.data()?.radioCallsign ?? null,
  };
}

function membershipData(
  eventId: string,
  event: Record<string, unknown>,
  user: UserRecord,
  summary: Awaited<ReturnType<typeof userSummary>>,
  role: "manager" | "pilot" | "retriever" | "observer" | null,
  status: "pending" | "invited" | "approved" | "rejected" | "declined",
) {
  return {
    id: membershipId(eventId, user.uid),
    eventId,
    eventName: event.name,
    eventVisibility: event.visibility,
    eventStartsAt: event.startsAt,
    eventEndsAt: event.endsAt,
    userId: user.uid,
    email: summary.email,
    displayName: summary.displayName,
    radioCallsign: summary.radioCallsign,
    role,
    status,
    requestedAt: FieldValue.serverTimestamp(),
    reviewedAt: status === "approved" ? FieldValue.serverTimestamp() : null,
    reviewedBy: null,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function auditData(
  eventId: string,
  actorId: string,
  action: string,
  targetId: string | null = null,
) {
  return {
    eventId,
    actorId,
    action,
    targetId,
    createdAt: FieldValue.serverTimestamp(),
  };
}

async function getUserByEmail(email: string) {
  try {
    return await getAuth(adminApp).getUserByEmail(email.trim().toLowerCase());
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (code === "auth/user-not-found") {
      throw new HttpsError(
        "not-found",
        "This email must sign in to RETFAST before it can be assigned.",
      );
    }
    throw error;
  }
}

export const createEvent = onCall(async (request) => {
  const actor = requireSuperadmin(request);
  const input = parseInput(createEventInputSchema, request.data);
  const eventReference = db.collection("events").doc();
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  const actorUser = await getAuth(adminApp).getUser(actor.uid);
  const managers = new Map<string, UserRecord>([[actor.uid, actorUser]]);

  if (input.managerEmail) {
    const manager = await getUserByEmail(input.managerEmail);
    managers.set(manager.uid, manager);
  }

  const event = {
    id: eventReference.id,
    name: input.name,
    slug: `${slugify(input.name)}-${eventReference.id.slice(0, 6)}`,
    description: input.description,
    venue: input.venue,
    startsAt: Timestamp.fromDate(startsAt),
    endsAt: Timestamp.fromDate(endsAt),
    timezone: input.timezone,
    visibility: input.visibility,
    status: input.status,
    managerIds: [...managers.keys()],
    participantCount: managers.size,
    createdBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const summaries = await Promise.all(
    [...managers.values()].map(async (user) => [user.uid, await userSummary(user)] as const),
  );
  const batch = db.batch();
  batch.create(eventReference, event);
  for (const [userId, summary] of summaries) {
    const user = managers.get(userId);
    if (!user) continue;
    batch.set(
      db.doc(`eventMemberships/${membershipId(eventReference.id, userId)}`),
      membershipData(eventReference.id, event, user, summary, "manager", "approved"),
    );
  }
  batch.create(db.collection("auditLogs").doc(), auditData(eventReference.id, actor.uid, "event.created"));
  await batch.commit();

  const lifecycleQueued =
    input.status === "published"
      ? await enqueueLifecycleTasks(eventReference.id, startsAt, endsAt)
      : false;
  return { eventId: eventReference.id, lifecycleQueued };
});

export const updateEvent = onCall(async (request) => {
  const actor = requireAuth(request);
  const input = parseInput(updateEventInputSchema, request.data);
  if (actor.token.superadmin !== true) {
    await requireEventManager(actor.uid, input.eventId);
  }
  const eventReference = db.doc(`events/${input.eventId}`);
  const current = await eventReference.get();
  if (!current.exists) throw new HttpsError("not-found", "Event not found.");
  const currentData = current.data();
  const startsAt = input.startsAt
    ? new Date(input.startsAt)
    : (currentData?.startsAt as Timestamp).toDate();
  const endsAt = input.endsAt
    ? new Date(input.endsAt)
    : (currentData?.endsAt as Timestamp).toDate();
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new HttpsError("invalid-argument", "Event end must be after its start.");
  }

  const changes: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  for (const field of ["name", "description", "venue", "timezone", "visibility", "status"] as const) {
    if (input[field] !== undefined) changes[field] = input[field];
  }
  if (input.name) changes.slug = `${slugify(input.name)}-${input.eventId.slice(0, 6)}`;
  if (input.startsAt) changes.startsAt = Timestamp.fromDate(startsAt);
  if (input.endsAt) changes.endsAt = Timestamp.fromDate(endsAt);

  const batch = db.batch();
  batch.update(eventReference, changes);
  batch.create(db.collection("auditLogs").doc(), auditData(input.eventId, actor.uid, "event.updated"));
  await batch.commit();

  const nextStatus = input.status ?? currentData?.status;
  const lifecycleQueued =
    nextStatus === "published" || nextStatus === "active"
      ? await enqueueLifecycleTasks(input.eventId, startsAt, endsAt)
      : false;
  return { eventId: input.eventId, lifecycleQueued };
});

export const applyToEvent = onCall(async (request) => {
  const actor = requireAuth(request);
  const input = parseInput(applyToEventInputSchema, request.data);
  const eventReference = db.doc(`events/${input.eventId}`);
  const memberReference = db.doc(
    `eventMemberships/${membershipId(input.eventId, actor.uid)}`,
  );
  const authUser = await getAuth(adminApp).getUser(actor.uid);
  const summary = await userSummary(authUser);

  await db.runTransaction(async (transaction) => {
    const [eventSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(eventReference),
      transaction.get(memberReference),
    ]);
    if (!eventSnapshot.exists) throw new HttpsError("not-found", "Event not found.");
    const event = eventSnapshot.data() as Record<string, unknown>;
    if (event.visibility !== "public" || !["published", "active"].includes(String(event.status))) {
      throw new HttpsError("failed-precondition", "This event is not accepting applications.");
    }
    if (memberSnapshot.exists && ["pending", "approved", "invited"].includes(memberSnapshot.data()?.status)) {
      throw new HttpsError("already-exists", "An active membership already exists.");
    }
    transaction.set(
      memberReference,
      membershipData(input.eventId, event, authUser, summary, null, "pending"),
    );
    transaction.create(
      db.collection("auditLogs").doc(),
      auditData(input.eventId, actor.uid, "membership.applied", actor.uid),
    );
  });
  return { membershipId: memberReference.id };
});

export const setEventManager = onCall(async (request) => {
  const actor = requireSuperadmin(request);
  const input = parseInput(setEventManagerInputSchema, request.data);
  const manager = await getUserByEmail(input.email);
  const summary = await userSummary(manager);
  const eventReference = db.doc(`events/${input.eventId}`);
  const memberReference = db.doc(
    `eventMemberships/${membershipId(input.eventId, manager.uid)}`,
  );

  await db.runTransaction(async (transaction) => {
    const [eventSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(eventReference),
      transaction.get(memberReference),
    ]);
    if (!eventSnapshot.exists) throw new HttpsError("not-found", "Event not found.");
    const event = eventSnapshot.data() as Record<string, unknown>;
    const managerIds = Array.isArray(event.managerIds) ? (event.managerIds as string[]) : [];
    transaction.update(eventReference, {
      managerIds: FieldValue.arrayUnion(manager.uid),
      participantCount: memberSnapshot.data()?.status === "approved"
        ? event.participantCount
        : FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(
      memberReference,
      {
        ...membershipData(input.eventId, event, manager, summary, "manager", "approved"),
        requestedAt: memberSnapshot.data()?.requestedAt ?? FieldValue.serverTimestamp(),
        reviewedBy: actor.uid,
      },
    );
    if (managerIds.includes(manager.uid)) return;
    transaction.create(
      db.collection("auditLogs").doc(),
      auditData(input.eventId, actor.uid, "manager.assigned", manager.uid),
    );
  });
  return { userId: manager.uid };
});

export const inviteEventMember = onCall(async (request) => {
  const actor = requireAuth(request);
  const input = parseInput(inviteMemberInputSchema, request.data);
  if (actor.token.superadmin !== true) await requireEventManager(actor.uid, input.eventId);
  const invitedUser = await getUserByEmail(input.email);
  const summary = await userSummary(invitedUser);
  const eventReference = db.doc(`events/${input.eventId}`);
  const eventSnapshot = await eventReference.get();
  if (!eventSnapshot.exists) throw new HttpsError("not-found", "Event not found.");
  const event = eventSnapshot.data() as Record<string, unknown>;
  const memberReference = db.doc(
    `eventMemberships/${membershipId(input.eventId, invitedUser.uid)}`,
  );

  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(memberReference);
    transaction.set(memberReference, {
      ...membershipData(input.eventId, event, invitedUser, summary, input.role, "approved"),
      requestedAt: existing.data()?.requestedAt ?? FieldValue.serverTimestamp(),
      reviewedBy: actor.uid,
    });
    if (existing.data()?.status !== "approved") {
      transaction.update(eventReference, {
        participantCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.create(
      db.collection("auditLogs").doc(),
      auditData(input.eventId, actor.uid, "member.added", invitedUser.uid),
    );
  });
  return { userId: invitedUser.uid };
});

export const reviewEventMembership = onCall(async (request) => {
  const actor = requireAuth(request);
  const input = parseInput(reviewMembershipInputSchema, request.data);
  if (actor.token.superadmin !== true) await requireEventManager(actor.uid, input.eventId);
  const eventReference = db.doc(`events/${input.eventId}`);
  const memberReference = db.doc(
    `eventMemberships/${membershipId(input.eventId, input.userId)}`,
  );

  await db.runTransaction(async (transaction) => {
    const [eventSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(eventReference),
      transaction.get(memberReference),
    ]);
    if (!eventSnapshot.exists || !memberSnapshot.exists) {
      throw new HttpsError("not-found", "Membership not found.");
    }
    const member = memberSnapshot.data()!;
    if (member.role === "manager") {
      throw new HttpsError("failed-precondition", "Manager memberships cannot be reviewed here.");
    }
    const wasApproved = member.status === "approved";
    const willBeApproved = input.decision === "approved";
    transaction.update(memberReference, {
      status: input.decision,
      role: willBeApproved ? input.role : null,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (wasApproved !== willBeApproved) {
      transaction.update(eventReference, {
        participantCount: FieldValue.increment(willBeApproved ? 1 : -1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.create(
      db.collection("auditLogs").doc(),
      auditData(input.eventId, actor.uid, `membership.${input.decision}`, input.userId),
    );
  });
  return { userId: input.userId, status: input.decision };
});
