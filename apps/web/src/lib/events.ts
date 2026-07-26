import type {
  CreateEventInput,
  EventRole,
  EventStatus,
  EventVisibility,
  UpdateEventInput,
} from "@retfast/domain";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../contexts/AuthContext";
import { db, functions } from "./firebase";

export type EventView = {
  id: string;
  name: string;
  slug: string;
  description: string;
  venue: string;
  startsAt: Timestamp;
  endsAt: Timestamp;
  timezone: string;
  visibility: EventVisibility;
  status: EventStatus;
  managerIds: string[];
  participantCount: number;
  createdBy: string;
};

export type MembershipView = {
  id: string;
  eventId: string;
  eventName: string;
  eventVisibility: EventVisibility;
  eventStartsAt: Timestamp;
  eventEndsAt: Timestamp;
  userId: string;
  email: string;
  displayName: string;
  radioCallsign: string | null;
  role: EventRole | null;
  status: "pending" | "invited" | "approved" | "rejected" | "declined";
  requestedAt: Timestamp | null;
};

function byStartDescending(left: EventView, right: EventView) {
  return right.startsAt.toMillis() - left.startsAt.toMillis();
}

export function useEvents() {
  const { user, profile } = useAuth();
  const [publicEvents, setPublicEvents] = useState<EventView[]>([]);
  const [memberEvents, setMemberEvents] = useState<EventView[]>([]);
  const [memberships, setMemberships] = useState<MembershipView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const eventQuery =
      profile?.globalRole === "superadmin"
        ? query(collection(db, "events"), orderBy("startsAt", "desc"))
        : query(
            collection(db, "events"),
            where("visibility", "==", "public"),
            where("status", "in", ["published", "active", "completed"]),
            orderBy("startsAt", "desc"),
          );
    const unsubscribe = onSnapshot(
      eventQuery,
      (snapshot) => {
        setPublicEvents(
          snapshot.docs.map((item) => item.data() as EventView).sort(byStartDescending),
        );
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [profile?.globalRole, user]);

  useEffect(() => {
    if (!user) return;
    const membershipQuery = query(
      collection(db, "eventMemberships"),
      where("userId", "==", user.uid),
      orderBy("eventStartsAt", "desc"),
    );
    let active = true;
    const unsubscribe = onSnapshot(
      membershipQuery,
      async (snapshot) => {
        const nextMemberships = snapshot.docs.map(
          (item) => item.data() as MembershipView,
        );
        setMemberships(nextMemberships);
        const eventSnapshots = await Promise.all(
          nextMemberships.map((membership) =>
            getDoc(doc(db, "events", membership.eventId)),
          ),
        );
        if (active) {
          setMemberEvents(
            eventSnapshots
              .filter((item) => item.exists())
              .map((item) => item.data() as EventView)
              .sort(byStartDescending),
          );
          setLoading(false);
        }
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [user]);

  const events = useMemo(() => {
    const merged = new Map<string, EventView>();
    for (const event of [...publicEvents, ...memberEvents]) merged.set(event.id, event);
    return [...merged.values()].sort(byStartDescending);
  }, [memberEvents, publicEvents]);

  const membershipByEvent = useMemo(
    () => new Map(memberships.map((membership) => [membership.eventId, membership])),
    [memberships],
  );

  return { events, memberships, membershipByEvent, loading, error };
}

export function useEvent(eventId: string | undefined) {
  const [event, setEvent] = useState<EventView | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!eventId) return;
    return onSnapshot(
      doc(db, "events", eventId),
      (snapshot) => {
        setEvent(snapshot.exists() ? (snapshot.data() as EventView) : null);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [eventId]);
  return { event, loading };
}

export function useEventMembers(eventId: string | undefined, enabled: boolean) {
  const [members, setMembers] = useState<MembershipView[]>([]);
  const [loading, setLoading] = useState(enabled);
  useEffect(() => {
    if (!eventId || !enabled) {
      setLoading(false);
      return;
    }
    const membersQuery = query(
      collection(db, "eventMemberships"),
      where("eventId", "==", eventId),
      orderBy("requestedAt", "desc"),
    );
    return onSnapshot(
      membersQuery,
      (snapshot) => {
        setMembers(snapshot.docs.map((item) => item.data() as MembershipView));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [enabled, eventId]);
  return { members, loading };
}

export async function createEventCommand(input: CreateEventInput) {
  return (await httpsCallable<CreateEventInput, { eventId: string }>(
    functions,
    "createEvent",
  )(input)).data;
}

export async function updateEventCommand(input: UpdateEventInput) {
  return (await httpsCallable<UpdateEventInput, { eventId: string }>(
    functions,
    "updateEvent",
  )(input)).data;
}

export async function applyToEventCommand(eventId: string) {
  await httpsCallable(functions, "applyToEvent")({ eventId });
}

export async function setEventManagerCommand(eventId: string, email: string) {
  await httpsCallable(functions, "setEventManager")({ eventId, email });
}

export async function inviteEventMemberCommand(
  eventId: string,
  email: string,
  role: Exclude<EventRole, "manager">,
) {
  await httpsCallable(functions, "inviteEventMember")({ eventId, email, role });
}

export async function reviewMembershipCommand(
  eventId: string,
  userId: string,
  decision: "approved" | "rejected",
  role?: Exclude<EventRole, "manager">,
) {
  await httpsCallable(functions, "reviewEventMembership")({
    eventId,
    userId,
    decision,
    role,
  });
}
