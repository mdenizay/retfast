import type { Connectivity, TrackingRole } from "@retfast/domain";
import { onValue, ref, type DataSnapshot } from "firebase/database";
import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";

import { functions, realtime } from "./firebase";

export type LiveParticipant = {
  sessionId: string;
  userId: string;
  role: TrackingRole;
  displayName: string;
  radioCallsign: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  batteryLevel: number | null;
  isCharging: boolean | null;
  connectivity: Connectivity;
  recordedAt: number;
  receivedAt: number;
  online: boolean;
  lastDisconnectedAt?: number | null;
};

function participantsFromSnapshot(snapshot: DataSnapshot) {
  const value = snapshot.val() as Record<string, LiveParticipant> | null;
  return value ? Object.values(value) : [];
}

export function useLiveParticipants(eventId: string | undefined, enabled: boolean) {
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId || !enabled) return;
    let unsubscribeLive: (() => void) | undefined;
    let unsubscribeConnection: (() => void) | undefined;
    let cancelled = false;
    void httpsCallable<{ eventId: string }, { role: string }>(
      functions,
      "prepareEventRealtime",
    )({ eventId }).then(() => {
      if (cancelled) return;
      unsubscribeLive = onValue(
        ref(realtime, `live/${eventId}`),
        (snapshot) => {
          setParticipants(participantsFromSnapshot(snapshot));
          setLoading(false);
        },
        (readError) => {
          setError(readError.message);
          setLoading(false);
        },
      );
      unsubscribeConnection = onValue(
        ref(realtime, ".info/connected"),
        (snapshot) => setConnected(snapshot.val() === true),
      );
    }).catch((prepareError: unknown) => {
      setError(prepareError instanceof Error ? prepareError.message : "realtime/access-failed");
      setLoading(false);
    });
    return () => {
      cancelled = true;
      unsubscribeLive?.();
      unsubscribeConnection?.();
    };
  }, [enabled, eventId]);

  return {
    participants: enabled ? participants : [],
    connected: enabled && connected,
    loading: enabled && loading,
    error: enabled ? error : null,
  };
}
