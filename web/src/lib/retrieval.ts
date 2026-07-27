import { useEffect, useState } from "react";

import { apiRequest, timestamp, type ApiTimestamp } from "./api";

export type RetrievalStatus = "searching" | "offered" | "assigned" | "picked_up" | "delivered" | "cancelled";
export type RetrievalJob = {
  id: string; eventId: string; sessionId: string; pilotId: string; pilotName: string;
  pilotRadioCallsign: string | null; urgency: "normal" | "emergency"; status: RetrievalStatus;
  landing: { latitude: number; longitude: number; recordedAt: number };
  offeredRetrieverId: string | null; offeredRetrieverName: string | null;
  assignedRetrieverId: string | null; assignedRetrieverName: string | null;
  requestedAt: ApiTimestamp | null;
};
export type RetrieverState = {
  id: string; eventId: string; userId: string; displayName: string;
  capacity: number; assignedCount: number; availability: "inactive" | "available" | "busy" | "offline";
};
type ApiJob = Omit<RetrievalJob, "requestedAt"> & { requestedAt: string | null };

export function useRetrievalOperations(eventId: string) {
  const [jobs, setJobs] = useState<RetrievalJob[]>([]);
  const [retrievers, setRetrievers] = useState<RetrieverState[]>([]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const data = await apiRequest<{ jobs: ApiJob[]; retrievers: Array<Omit<RetrieverState, "id">> }>(`/v1/events/${eventId}/retrieval`);
      if (!active) return;
      setJobs(data.jobs.filter((job) => job.landing).map((job) => ({ ...job, requestedAt: timestamp(job.requestedAt) })));
      setRetrievers(data.retrievers.map((retriever) => ({ ...retriever, id: `${retriever.eventId}_${retriever.userId}` })));
    };
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => { active = false; clearInterval(timer); };
  }, [eventId]);
  return { jobs, retrievers };
}

export async function managerDispatchRetrievalCommand(eventId: string, sessionId: string, retrieverId: string) {
  return apiRequest(`/v1/events/${eventId}/retrieval/dispatch`, {
    method: "POST", body: JSON.stringify({ sessionId, retrieverId, urgency: "normal" }),
  });
}
export async function managerAssignRetrievalCommand(eventId: string, jobId: string, retrieverId: string) {
  return apiRequest(`/v1/events/${eventId}/retrieval/transfers`, {
    method: "POST", body: JSON.stringify({ jobIds: [jobId], targetRetrieverId: retrieverId }),
  });
}
export async function updateRetrievalCommand(eventId: string, jobId: string, action: "picked_up" | "delivered" | "cancelled") {
  return apiRequest(`/v1/events/${eventId}/retrieval/jobs/${jobId}/progress`, {
    method: "POST", body: JSON.stringify({ action }),
  });
}
