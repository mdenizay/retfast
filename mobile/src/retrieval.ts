import { useEffect, useMemo, useState } from "react";

import { apiRequest, timestamp, type ApiTimestamp } from "./lib/api";

export type RetrieverAvailability = "inactive" | "available" | "busy" | "offline";
export type RetrievalStatus = "searching" | "offered" | "assigned" | "picked_up" | "delivered" | "cancelled";
export type RetrieverState = {
  id: string; eventId: string; userId: string; displayName: string;
  radioCallsign: string | null; capacity: number; assignedCount: number;
  availability: RetrieverAvailability; busyReason: "manual" | "full" | null;
};
export type RetrievalJob = {
  id: string; eventId: string; sessionId: string; pilotId: string; pilotName: string;
  pilotRadioCallsign: string | null; urgency: "normal" | "emergency"; status: RetrievalStatus;
  landing: { latitude: number; longitude: number; recordedAt: number };
  offeredRetrieverId: string | null; offeredRetrieverName: string | null;
  assignedRetrieverId: string | null; assignedRetrieverName: string | null;
  offerExpiresAt: ApiTimestamp | null; requestedAt: ApiTimestamp | null;
};
export type NearbyRetriever = {
  userId: string; displayName: string; capacity: number; assignedCount: number;
  latitude: number; longitude: number; distanceKm: number;
};

export async function configureRetrieverCommand(eventId: string, capacity: number, availability: Exclude<RetrieverAvailability, "offline">) {
  return apiRequest(`/v1/events/${eventId}/retrievers/me`, {
    method: "PUT", body: JSON.stringify({ capacity, availability }),
  });
}
export async function listNearbyRetrieversCommand(eventId: string, sessionId: string) {
  return (await apiRequest<{ retrievers: NearbyRetriever[] }>(
    `/v1/events/${eventId}/retrievers/nearby?sessionId=${encodeURIComponent(sessionId)}`,
  )).retrievers;
}
export async function requestRetrievalCommand(eventId: string, sessionId: string, retrieverId: string, urgency: "normal" | "emergency") {
  return apiRequest(`/v1/events/${eventId}/retrieval/jobs`, {
    method: "POST", body: JSON.stringify({ sessionId, retrieverId, urgency }),
  });
}
export async function respondRetrievalCommand(eventId: string, jobId: string, accept: boolean) {
  return apiRequest(`/v1/events/${eventId}/retrieval/jobs/${jobId}/respond`, {
    method: "POST", body: JSON.stringify({ accept }),
  });
}
export async function updateRetrievalCommand(eventId: string, jobId: string, action: "picked_up" | "delivered" | "cancelled") {
  return apiRequest(`/v1/events/${eventId}/retrieval/jobs/${jobId}/progress`, {
    method: "POST", body: JSON.stringify({ action }),
  });
}

type ApiJob = Omit<RetrievalJob, "offerExpiresAt" | "requestedAt"> & { offerExpiresAt: string | null; requestedAt: string | null };
export function useRetrievalOperations(eventId: string | undefined, enabled: boolean) {
  const [jobs, setJobs] = useState<RetrievalJob[]>([]);
  const [retrievers, setRetrievers] = useState<RetrieverState[]>([]);
  useEffect(() => {
    if (!eventId || !enabled) return;
    let active = true;
    const load = async () => {
      const data = await apiRequest<{ jobs: ApiJob[]; retrievers: Omit<RetrieverState, "id" | "busyReason">[] }>(
        `/v1/events/${eventId}/retrieval`,
      );
      if (!active) return;
      setJobs(data.jobs.filter((job) => job.landing).map((job) => ({
        ...job, offerExpiresAt: timestamp(job.offerExpiresAt), requestedAt: timestamp(job.requestedAt),
      })));
      setRetrievers(data.retrievers.map((retriever) => ({
        ...retriever, id: `${retriever.eventId}_${retriever.userId}`, busyReason: null,
      })));
    };
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => { active = false; clearInterval(timer); };
  }, [enabled, eventId]);
  return useMemo(() => ({ jobs: enabled ? jobs : [], retrievers: enabled ? retrievers : [] }), [enabled, jobs, retrievers]);
}
