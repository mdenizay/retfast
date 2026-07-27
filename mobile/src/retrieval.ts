import {
  collection,
  getFirestore,
  onSnapshot,
  query,
  type Timestamp,
  where,
} from "@react-native-firebase/firestore";
import { getFunctions, httpsCallable } from "@react-native-firebase/functions";
import { useEffect, useMemo, useState } from "react";

const firestore = getFirestore();
const functions = getFunctions(undefined, "europe-west1");

export type RetrieverAvailability = "inactive" | "available" | "busy" | "offline";
export type RetrievalStatus =
  | "searching"
  | "offered"
  | "assigned"
  | "picked_up"
  | "delivered"
  | "cancelled";

export type RetrieverState = {
  id: string;
  eventId: string;
  userId: string;
  displayName: string;
  radioCallsign: string | null;
  capacity: number;
  assignedCount: number;
  availability: RetrieverAvailability;
  busyReason: "manual" | "full" | null;
};

export type RetrievalJob = {
  id: string;
  eventId: string;
  sessionId: string;
  pilotId: string;
  pilotName: string;
  pilotRadioCallsign: string | null;
  urgency: "normal" | "emergency";
  status: RetrievalStatus;
  landing: {
    latitude: number;
    longitude: number;
    recordedAt: number;
  };
  offeredRetrieverId: string | null;
  offeredRetrieverName: string | null;
  assignedRetrieverId: string | null;
  assignedRetrieverName: string | null;
  offerExpiresAt: Timestamp | null;
  requestedAt: Timestamp | null;
};

export type NearbyRetriever = {
  userId: string;
  displayName: string;
  capacity: number;
  assignedCount: number;
  latitude: number;
  longitude: number;
  distanceKm: number;
};

export async function configureRetrieverCommand(
  eventId: string,
  capacity: number,
  availability: Exclude<RetrieverAvailability, "offline">,
) {
  const command = httpsCallable<
    { eventId: string; capacity: number; availability: string },
    { configured: boolean }
  >(functions, "configureRetriever");
  return (await command({ eventId, capacity, availability })).data;
}

export async function listNearbyRetrieversCommand(
  eventId: string,
  sessionId: string,
) {
  const command = httpsCallable<
    { eventId: string; sessionId: string },
    { retrievers: NearbyRetriever[] }
  >(functions, "listNearbyRetrievers");
  return (await command({ eventId, sessionId })).data.retrievers;
}

export async function requestRetrievalCommand(
  eventId: string,
  sessionId: string,
  retrieverId: string,
  urgency: "normal" | "emergency",
) {
  const command = httpsCallable<
    {
      eventId: string;
      sessionId: string;
      retrieverId: string;
      urgency: "normal" | "emergency";
    },
    { jobId: string }
  >(functions, "requestRetrieval");
  return (await command({ eventId, sessionId, retrieverId, urgency })).data;
}

export async function respondRetrievalCommand(
  eventId: string,
  jobId: string,
  accept: boolean,
) {
  const command = httpsCallable<
    { eventId: string; jobId: string; accept: boolean },
    { jobId: string; accepted: boolean }
  >(functions, "respondRetrievalOffer");
  return (await command({ eventId, jobId, accept })).data;
}

export async function updateRetrievalCommand(
  eventId: string,
  jobId: string,
  action: "picked_up" | "delivered" | "cancelled",
) {
  const command = httpsCallable<
    { eventId: string; jobId: string; action: string },
    { jobId: string; status: RetrievalStatus }
  >(functions, "updateRetrievalProgress");
  return (await command({ eventId, jobId, action })).data;
}

export function useRetrievalOperations(
  eventId: string | undefined,
  enabled: boolean,
) {
  const [jobs, setJobs] = useState<RetrievalJob[]>([]);
  const [retrievers, setRetrievers] = useState<RetrieverState[]>([]);

  useEffect(() => {
    if (!eventId || !enabled) return;
    const jobsQuery = query(
      collection(firestore, "retrievalJobs"),
      where("eventId", "==", eventId),
    );
    const statesQuery = query(
      collection(firestore, "retrieverStates"),
      where("eventId", "==", eventId),
    );
    const unsubscribeJobs = onSnapshot(jobsQuery, (snapshot) => {
      setJobs(snapshot.docs.map((item) => item.data() as RetrievalJob));
    });
    const unsubscribeStates = onSnapshot(statesQuery, (snapshot) => {
      setRetrievers(snapshot.docs.map((item) => item.data() as RetrieverState));
    });
    return () => {
      unsubscribeJobs();
      unsubscribeStates();
    };
  }, [enabled, eventId]);

  return useMemo(
    () => ({
      jobs: enabled ? jobs : [],
      retrievers: enabled ? retrievers : [],
    }),
    [enabled, jobs, retrievers],
  );
}
