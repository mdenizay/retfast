import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../contexts/AuthContext";
import type { EventRole, EventStatus, EventVisibility } from "../domain";
import { apiRequest, timestamp, type ApiTimestamp } from "./api";

export type MobileEvent = {
  id: string; name: string; description: string; venue: string;
  startsAt: ApiTimestamp; endsAt: ApiTimestamp; timezone: string;
  visibility: EventVisibility; status: EventStatus; managerIds: string[];
  participantCount: number;
};
export type MobileMembership = {
  id: string; eventId: string; userId: string;
  status: "pending" | "invited" | "approved" | "rejected" | "declined";
  role: EventRole | null;
};
type ApiEvent = Omit<MobileEvent, "startsAt" | "endsAt" | "managerIds"> & {
  startsAt: string; endsAt: string; managerUserId: string;
  membershipRole: EventRole | null; membershipStatus: MobileMembership["status"] | null;
};
function mapEvent(event: ApiEvent): MobileEvent {
  return { ...event, startsAt: timestamp(event.startsAt)!, endsAt: timestamp(event.endsAt)!, managerIds: [event.managerUserId] };
}
export function useMobileEvents() {
  const { user } = useAuth();
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [memberships, setMemberships] = useState<MobileMembership[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = async () => {
      try {
        const data = await apiRequest<{ events: ApiEvent[] }>("/v1/events");
        if (!active) return;
        setEvents(data.events.map(mapEvent));
        setMemberships(data.events.filter((event) => event.membershipStatus).map((event) => ({
          id: `${event.id}_${user.uid}`, eventId: event.id, userId: user.uid,
          status: event.membershipStatus!, role: event.membershipRole,
        })));
      } finally { if (active) setLoading(false); }
    };
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [user]);
  const membershipByEvent = useMemo(() => new Map(memberships.map((membership) => [membership.eventId, membership])), [memberships]);
  return { events, membershipByEvent, loading };
}
export function useMobileEvent(eventId: string | undefined) {
  const [event, setEvent] = useState<MobileEvent | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!eventId) return;
    let active = true;
    const load = async () => {
      try {
        const data = await apiRequest<{ event: ApiEvent }>(`/v1/events/${eventId}`);
        if (active) setEvent(mapEvent(data.event));
      } finally { if (active) setLoading(false); }
    };
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [eventId]);
  return { event, loading };
}
export async function applyToEvent(eventId: string) {
  await apiRequest(`/v1/events/${eventId}/applications`, { method: "POST", body: "{}" });
}
