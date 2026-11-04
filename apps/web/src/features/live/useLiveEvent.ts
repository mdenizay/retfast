import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { eventsApi } from "@/lib/api/endpoints";
import type { Flight, LiveSnapshot } from "@/lib/api/types";
import { LiveStore, viewPilots, type PositionMessageData } from "./store";
import { useRealtime } from "./useRealtime";
import type { ServerMessage } from "./realtime";
import { useNow } from "@/hooks/useNow";

export const SNAPSHOT_REFRESH_MS = 60_000;
export const SNAPSHOT_REFRESH_DEGRADED_MS = 15_000;

function isSnapshot(x: unknown): x is LiveSnapshot {
  return Boolean(x && typeof x === "object" && Array.isArray((x as LiveSnapshot).pilots));
}

/**
 * Live event data = REST snapshot (re-fetched periodically so the map never depends only on the
 * volatile socket) + WebSocket `event:<id>` deltas, merged in LiveStore.
 */
export function useLiveEvent(eventId: string | undefined) {
  const [store] = useState(() => new LiveStore(eventId ?? null));
  useEffect(() => {
    store.dispatch({ type: "reset", eventId: eventId ?? null });
  }, [store, eventId]);

  const channel = eventId ? `event:${eventId}` : "";

  const onMessage = useCallback(
    (msg: ServerMessage) => {
      if (msg.channel && msg.channel !== channel) return;
      const now = Date.now();
      switch (msg.type) {
        case "subscribed":
          if (isSnapshot(msg.snapshot)) store.dispatch({ type: "snapshot", snapshot: { ...msg.snapshot, cursor: msg.cursor ?? msg.snapshot.cursor }, nowMs: now, source: "ws" });
          else if (msg.cursor) store.dispatch({ type: "cursor", cursor: msg.cursor });
          break;
        case "position":
          if (msg.data) store.enqueue({ type: "position", data: msg.data as PositionMessageData, cursor: msg.cursor, nowMs: now });
          break;
        case "flight":
          if (msg.data) store.enqueue({ type: "flight", data: msg.data as Flight, cursor: msg.cursor });
          break;
      }
    },
    [store, channel],
  );

  const channels = useMemo(() => (channel ? [{ channel, since: () => store.getState().cursor }] : []), [channel, store]);
  const rt = useRealtime(channels, onMessage, Boolean(eventId));

  const snapshot = useQuery({
    queryKey: ["live", eventId],
    queryFn: ({ signal }) => eventsApi.live(eventId!, signal),
    enabled: Boolean(eventId),
    refetchInterval: rt.status === "open" ? SNAPSHOT_REFRESH_MS : SNAPSHOT_REFRESH_DEGRADED_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  useEffect(() => {
    if (snapshot.data) store.dispatch({ type: "snapshot", snapshot: snapshot.data, nowMs: Date.now(), source: "rest" });
  }, [snapshot.data, store]);

  const state = useSyncExternalStore(store.subscribe, store.getState);
  const now = useNow(1000);
  const pilots = useMemo(() => viewPilots(state, now), [state, now]);

  return {
    pilots,
    state,
    now,
    connection: rt.status,
    reconnectAttempt: rt.attempt,
    snapshotError: snapshot.error,
    isLoading: snapshot.isLoading,
    lastSnapshotAt: snapshot.dataUpdatedAt || null,
    refetch: snapshot.refetch,
  };
}
