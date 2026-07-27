import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../contexts/AuthContext";
import type { CreateEventInput, EventRole, EventStatus, EventVisibility, UpdateEventInput } from "../domain";
import { apiRequest, timestamp, type ApiTimestamp } from "./api";

export type EventView = {
  id: string; name: string; slug: string; description: string; venue: string;
  startsAt: ApiTimestamp; endsAt: ApiTimestamp; timezone: string;
  visibility: EventVisibility; status: EventStatus; managerIds: string[];
  participantCount: number; createdBy: string;
};

export type MembershipView = {
  id: string; eventId: string; eventName: string; eventVisibility: EventVisibility;
  eventStartsAt: ApiTimestamp; eventEndsAt: ApiTimestamp; userId: string;
  email: string; displayName: string; radioCallsign: string | null;
  role: EventRole | null;
  status: "pending" | "invited" | "approved" | "rejected" | "declined";
  requestedAt: ApiTimestamp | null;
};

type ApiEvent = Omit<EventView, "startsAt" | "endsAt" | "managerIds"> & {
  startsAt: string; endsAt: string; managerUserId: string;
  membershipRole: EventRole | null; membershipStatus: MembershipView["status"] | null;
};

function mapEvent(event: ApiEvent): EventView {
  return { ...event, startsAt: timestamp(event.startsAt)!, endsAt: timestamp(event.endsAt)!, managerIds: [event.managerUserId] };
}

function poll(load: () => Promise<void>, interval: number) {
  void load();
  return window.setInterval(() => void load(), interval);
}

export function useEvents() {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventView[]>([]);
  const [memberships, setMemberships] = useState<MembershipView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = async () => {
      try {
        const data = await apiRequest<{ events: ApiEvent[] }>("/v1/events");
        if (!active) return;
        setEvents(data.events.map(mapEvent));
        setMemberships(data.events.filter((event) => event.membershipStatus).map((event) => ({
          id: `${event.id}_${user.uid}`, eventId: event.id, eventName: event.name,
          eventVisibility: event.visibility, eventStartsAt: timestamp(event.startsAt)!,
          eventEndsAt: timestamp(event.endsAt)!, userId: user.uid, email: user.email ?? "",
          displayName: user.displayName ?? user.email ?? "RETFAST User", radioCallsign: null,
          role: event.membershipRole, status: event.membershipStatus!, requestedAt: null,
        })));
        setError(null);
      } catch (loadError) { if (active) setError(String(loadError)); }
      finally { if (active) setLoading(false); }
    };
    const timer = poll(load, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [user]);
  const membershipByEvent = useMemo(
    () => new Map(memberships.map((membership) => [membership.eventId, membership])), [memberships],
  );
  return { events, memberships, membershipByEvent, loading, error };
}

export function useEvent(eventId: string | undefined) {
  const [event, setEvent] = useState<EventView | null>(null);
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
    const timer = poll(load, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [eventId]);
  return { event, loading };
}

export function useEventMembers(eventId: string | undefined, enabled: boolean) {
  const [members, setMembers] = useState<MembershipView[]>([]);
  const [loading, setLoading] = useState(enabled);
  useEffect(() => {
    if (!eventId || !enabled) { setLoading(false); return; }
    let active = true;
    const load = async () => {
      try {
        const data = await apiRequest<{ members: Array<Omit<MembershipView, "id" | "eventName" | "eventVisibility" | "eventStartsAt" | "eventEndsAt" | "requestedAt"> & { requestedAt: string | null }> }>(`/v1/events/${eventId}/members`);
        if (active) setMembers(data.members.map((member) => ({
          ...member, id: `${eventId}_${member.userId}`, eventName: "",
          eventVisibility: "private", eventStartsAt: timestamp(new Date(0))!,
          eventEndsAt: timestamp(new Date(0))!, requestedAt: timestamp(member.requestedAt),
        })));
      } finally { if (active) setLoading(false); }
    };
    const timer = poll(load, 10_000);
    return () => { active = false; clearInterval(timer); };
  }, [enabled, eventId]);
  return { members, loading };
}

export async function createEventCommand(input: CreateEventInput) {
  return apiRequest<{ eventId: string }>("/v1/events", { method: "POST", body: JSON.stringify(input) });
}
export async function updateEventCommand(input: UpdateEventInput) {
  const { eventId, ...changes } = input;
  return apiRequest<{ eventId: string }>(`/v1/events/${eventId}`, { method: "PATCH", body: JSON.stringify(changes) });
}
export async function applyToEventCommand(eventId: string) {
  await apiRequest(`/v1/events/${eventId}/applications`, { method: "POST", body: "{}" });
}
export async function setEventManagerCommand(eventId: string, email: string) {
  await apiRequest(`/v1/events/${eventId}/members`, { method: "POST", body: JSON.stringify({ email, role: "manager" }) });
}
export async function inviteEventMemberCommand(eventId: string, email: string, role: Exclude<EventRole, "manager">) {
  await apiRequest(`/v1/events/${eventId}/members`, { method: "POST", body: JSON.stringify({ email, role }) });
}
export async function reviewMembershipCommand(eventId: string, userId: string, decision: "approved" | "rejected", role?: Exclude<EventRole, "manager">) {
  await apiRequest(`/v1/events/${eventId}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ decision, role }) });
}
