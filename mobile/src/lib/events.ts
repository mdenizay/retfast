import {
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
  where,
} from "@react-native-firebase/firestore";
import { getFunctions, httpsCallable } from "@react-native-firebase/functions";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../contexts/AuthContext";
import type { EventRole, EventStatus, EventVisibility } from "../domain";

const firestore = getFirestore();
const functions = getFunctions(undefined, "europe-west1");

export type MobileEvent = {
  id: string;
  name: string;
  description: string;
  venue: string;
  startsAt: Timestamp;
  endsAt: Timestamp;
  timezone: string;
  visibility: EventVisibility;
  status: EventStatus;
  managerIds: string[];
  participantCount: number;
};

export type MobileMembership = {
  id: string;
  eventId: string;
  userId: string;
  status: "pending" | "invited" | "approved" | "rejected" | "declined";
  role: EventRole | null;
};

function sortEvents(events: MobileEvent[]) {
  return events.sort((left, right) => right.startsAt.toMillis() - left.startsAt.toMillis());
}

export function useMobileEvents() {
  const { user, profile } = useAuth();
  const [discoverable, setDiscoverable] = useState<MobileEvent[]>([]);
  const [assigned, setAssigned] = useState<MobileEvent[]>([]);
  const [memberships, setMemberships] = useState<MobileMembership[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const eventsQuery =
      profile?.globalRole === "superadmin"
        ? query(collection(firestore, "events"), orderBy("startsAt", "desc"))
        : query(
            collection(firestore, "events"),
            where("visibility", "==", "public"),
            where("status", "in", ["published", "active", "completed"]),
            orderBy("startsAt", "desc"),
          );
    return onSnapshot(eventsQuery, (snapshot) => {
      setDiscoverable(snapshot.docs.map((item) => item.data() as MobileEvent));
      setLoading(false);
    }, () => setLoading(false));
  }, [profile?.globalRole, user]);

  useEffect(() => {
    if (!user) return;
    const membershipsQuery = query(
      collection(firestore, "eventMemberships"),
      where("userId", "==", user.uid),
      orderBy("eventStartsAt", "desc"),
    );
    let active = true;
    const unsubscribe = onSnapshot(membershipsQuery, async (snapshot) => {
      const nextMemberships = snapshot.docs.map(
        (item) => item.data() as MobileMembership,
      );
      setMemberships(nextMemberships);
      const eventSnapshots = await Promise.all(
        nextMemberships.map((membership) =>
          getDoc(doc(firestore, "events", membership.eventId)),
        ),
      );
      if (active) {
        setAssigned(
          sortEvents(
            eventSnapshots
              .filter((item) => item.exists())
              .map((item) => item.data() as MobileEvent),
          ),
        );
        setLoading(false);
      }
    }, () => setLoading(false));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [user]);

  const events = useMemo(() => {
    const merged = new Map<string, MobileEvent>();
    for (const event of [...discoverable, ...assigned]) merged.set(event.id, event);
    return sortEvents([...merged.values()]);
  }, [assigned, discoverable]);
  const membershipByEvent = useMemo(
    () => new Map(memberships.map((membership) => [membership.eventId, membership])),
    [memberships],
  );
  return { events, membershipByEvent, loading };
}

export function useMobileEvent(eventId: string | undefined) {
  const [event, setEvent] = useState<MobileEvent | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!eventId) return;
    return onSnapshot(doc(firestore, "events", eventId), (snapshot) => {
      setEvent(snapshot.exists() ? (snapshot.data() as MobileEvent) : null);
      setLoading(false);
    }, () => setLoading(false));
  }, [eventId]);
  return { event, loading };
}

export async function applyToEvent(eventId: string) {
  await httpsCallable(functions, "applyToEvent")({ eventId });
}
