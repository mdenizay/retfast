import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
  where,
} from "firebase/firestore";
import { useEffect, useState } from "react";

import type { Connectivity, TrackingRole } from "../domain";
import { db } from "./firebase";

export type ReplaySession = {
  id: string;
  eventId: string;
  userId: string;
  displayName: string;
  radioCallsign: string | null;
  role: TrackingRole;
  status: "active" | "completed" | "cancelled" | "interrupted";
  startedAt: Timestamp | null;
  stoppedAt: Timestamp | null;
  pointCount: number;
};

export type ReplayPoint = {
  sequence: number;
  recordedAt: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  speed: number | null;
  heading: number | null;
  batteryLevel: number | null;
  isCharging: boolean | null;
  connectivity: Connectivity;
};

export type ReplayChunk = {
  points: ReplayPoint[];
};

export function mergeRouteChunks(chunks: ReplayChunk[]) {
  const pointsBySequence = new Map<number, ReplayPoint>();
  for (const chunk of chunks) {
    for (const point of chunk.points) {
      const existing = pointsBySequence.get(point.sequence);
      if (!existing || point.recordedAt >= existing.recordedAt) {
        pointsBySequence.set(point.sequence, point);
      }
    }
  }
  return [...pointsBySequence.values()].sort((left, right) =>
    left.recordedAt - right.recordedAt || left.sequence - right.sequence,
  );
}

export function useReplaySessions(eventId: string) {
  const [sessions, setSessions] = useState<ReplaySession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sessionsQuery = query(
      collection(db, "trackingSessions"),
      where("eventId", "==", eventId),
      orderBy("startedAt", "desc"),
    );
    return onSnapshot(sessionsQuery, (snapshot) => {
      setSessions(snapshot.docs.map((item) => item.data() as ReplaySession));
      setLoading(false);
    }, () => setLoading(false));
  }, [eventId]);

  return { sessions, loading };
}

export async function loadReplayPoints(sessionId: string) {
  const chunks = await getDocs(query(
    collection(db, "trackingSessions", sessionId, "chunks"),
    orderBy("firstRecordedAt", "asc"),
  ));
  return mergeRouteChunks(
    chunks.docs.map((item) => item.data() as ReplayChunk),
  );
}
