import {
  collection,
  onSnapshot,
  query,
  type Timestamp,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";

import { db, functions } from "./firebase";

export type RetrievalStatus =
  | "searching"
  | "offered"
  | "assigned"
  | "picked_up"
  | "delivered"
  | "cancelled";

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
  requestedAt: Timestamp | null;
};

export type RetrieverState = {
  id: string;
  eventId: string;
  userId: string;
  displayName: string;
  capacity: number;
  assignedCount: number;
  availability: "inactive" | "available" | "busy" | "offline";
};

export function useRetrievalOperations(eventId: string) {
  const [jobs, setJobs] = useState<RetrievalJob[]>([]);
  const [retrievers, setRetrievers] = useState<RetrieverState[]>([]);

  useEffect(() => {
    const jobQuery = query(
      collection(db, "retrievalJobs"),
      where("eventId", "==", eventId),
    );
    const retrieverQuery = query(
      collection(db, "retrieverStates"),
      where("eventId", "==", eventId),
    );
    const unsubscribeJobs = onSnapshot(jobQuery, (snapshot) => {
      setJobs(snapshot.docs.map((item) => item.data() as RetrievalJob));
    });
    const unsubscribeRetrievers = onSnapshot(retrieverQuery, (snapshot) => {
      setRetrievers(snapshot.docs.map((item) => item.data() as RetrieverState));
    });
    return () => {
      unsubscribeJobs();
      unsubscribeRetrievers();
    };
  }, [eventId]);

  return { jobs, retrievers };
}

export async function managerDispatchRetrievalCommand(
  eventId: string,
  sessionId: string,
  retrieverId: string,
) {
  const command = httpsCallable(functions, "managerDispatchRetrieval");
  return command({ eventId, sessionId, retrieverId, urgency: "normal" });
}

export async function managerAssignRetrievalCommand(
  eventId: string,
  jobId: string,
  retrieverId: string,
) {
  const command = httpsCallable(functions, "managerAssignRetrieval");
  return command({ eventId, jobId, retrieverId });
}

export async function updateRetrievalCommand(
  eventId: string,
  jobId: string,
  action: "picked_up" | "delivered" | "cancelled",
) {
  const command = httpsCallable(functions, "updateRetrievalProgress");
  return command({ eventId, jobId, action });
}
