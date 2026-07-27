import { useEffect, useState } from "react";

import type { Connectivity, TrackingRole } from "../domain";
import { apiRequest, timestamp, type ApiTimestamp } from "./api";

export type ReplaySession = {
  id: string; eventId: string; userId: string; displayName: string;
  radioCallsign: string | null; role: TrackingRole;
  status: "active" | "completed" | "cancelled" | "interrupted";
  startedAt: ApiTimestamp | null; stoppedAt: ApiTimestamp | null; pointCount: number;
};
export type ReplayPoint = {
  sequence: number; recordedAt: number; latitude: number; longitude: number;
  accuracy: number | null; altitude: number | null; altitudeAccuracy: number | null;
  speed: number | null; heading: number | null; batteryLevel: number | null;
  isCharging: boolean | null; connectivity: Connectivity;
};
export type ReplayChunk = { points: ReplayPoint[] };
export function mergeRouteChunks(chunks: ReplayChunk[]) {
  const pointsBySequence = new Map<number, ReplayPoint>();
  for (const chunk of chunks) for (const point of chunk.points) {
    const existing = pointsBySequence.get(point.sequence);
    if (!existing || point.recordedAt >= existing.recordedAt) pointsBySequence.set(point.sequence, point);
  }
  return [...pointsBySequence.values()].sort((left, right) => left.recordedAt-right.recordedAt || left.sequence-right.sequence);
}
type ApiSession = Omit<ReplaySession, "startedAt" | "stoppedAt"> & { startedAt: string | null; stoppedAt: string | null };
export function useReplaySessions(eventId: string) {
  const [sessions, setSessions] = useState<ReplaySession[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await apiRequest<{ sessions: ApiSession[] }>(`/v1/events/${eventId}/tracking/sessions`);
        if (active) setSessions(data.sessions.map((session) => ({
          ...session, startedAt: timestamp(session.startedAt), stoppedAt: timestamp(session.stoppedAt),
        })));
      } finally { if (active) setLoading(false); }
    };
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [eventId]);
  return { sessions, loading };
}
export async function loadReplayPoints(sessionId: string) {
  return (await apiRequest<{ points: ReplayPoint[] }>(`/v1/tracking/sessions/${sessionId}/points`)).points;
}
