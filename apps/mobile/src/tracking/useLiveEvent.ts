import {
  onValue,
  ref,
  type DataSnapshot,
} from "@react-native-firebase/database";
import { getFunctions, httpsCallable } from "@react-native-firebase/functions";
import { useEffect, useState } from "react";

import { realtime, realtimeReady } from "./firebase";
import type { LiveParticipant } from "./types";

const functions = getFunctions(undefined, "europe-west1");

function participantsFromSnapshot(snapshot: DataSnapshot) {
  const value = snapshot.val() as Record<string, LiveParticipant> | null;
  return value ? Object.values(value) : [];
}

export function useLiveEvent(eventId: string | undefined, enabled: boolean) {
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!eventId || !enabled) {
      return;
    }
    let unsubLive: (() => void) | undefined;
    let unsubConnection: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      await httpsCallable<{ eventId: string }, { role: string }>(
        functions,
        "prepareEventRealtime",
      )({ eventId });
      await realtimeReady;
      if (cancelled) return;
      unsubLive = onValue(
        ref(realtime, `live/${eventId}`),
        (snapshot) => {
          setParticipants(participantsFromSnapshot(snapshot));
          setLoading(false);
        },
        () => setLoading(false),
      );
      unsubConnection = onValue(ref(realtime, ".info/connected"), (snapshot) => {
        setConnected(snapshot.val() === true);
      });
    })().catch(() => setLoading(false));
    return () => {
      cancelled = true;
      unsubLive?.();
      unsubConnection?.();
    };
  }, [enabled, eventId]);

  return {
    participants: enabled ? participants : [],
    connected: enabled && connected,
    loading: enabled && loading,
  };
}
