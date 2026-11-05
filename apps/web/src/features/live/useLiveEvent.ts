import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { eventsApi, retrievalsApi } from "@/lib/api/endpoints";
import type { Flight, LiveRetriever, LiveSnapshot, Retrieval } from "@/lib/api/types";
import {
  LiveStore, viewPilots, viewRetrievers, type PilotPositionMessageData, type PositionMessageData, type RetrieverPositionMessageData,
} from "./store";
import { useRealtime, type ChannelSpec } from "./useRealtime";
import type { ServerMessage } from "./realtime";
import { useNow } from "@/hooks/useNow";

export const SNAPSHOT_REFRESH_MS = 60_000;
export const SNAPSHOT_REFRESH_DEGRADED_MS = 15_000;

function isSnapshot(x: unknown): x is LiveSnapshot {
  return Boolean(x && typeof x === "object" && Array.isArray((x as LiveSnapshot).pilots));
}

/** A `retrievals:` subscribe snapshot may be a list, `{items}` or a live-shaped `{retrievals, retrievers}`. */
function retrievalSnapshot(x: unknown): { items: Retrieval[]; retrievers?: LiveRetriever[]; serverTime?: string } | null {
  if (Array.isArray(x)) return { items: x as Retrieval[] };
  if (x && typeof x === "object") {
    const o = x as { items?: unknown; retrievals?: unknown; retrievers?: unknown; server_time?: string };
    const items = Array.isArray(o.retrievals) ? o.retrievals : Array.isArray(o.items) ? o.items : null;
    if (items) {
      return {
        items: items as Retrieval[],
        retrievers: Array.isArray(o.retrievers) ? (o.retrievers as LiveRetriever[]) : undefined,
        serverTime: o.server_time,
      };
    }
  }
  return null;
}

export interface LiveOptions {
  /** Pilots: REST /live snapshot + `event:<id>` channel. Off for retrievers (they don't get the general map). */
  pilots?: boolean;
  /** Retrievals: `retrievals:<id>` channel (signed-in members only). */
  retrievals?: boolean;
}

/**
 * Live event data = REST snapshot (re-fetched periodically so the screen never depends only on the
 * volatile socket) + WebSocket deltas, merged in LiveStore.
 *  - pilots on: GET /events/{id}/live (pilots + retrievals + retrievers as visible to the caller) and `event:<id>`
 *  - pilots off: GET /events/{id}/retrievals?status=requested,accepted,picked_up (retriever view)
 *  - retrievals on: `retrievals:<id>` (retrieval / retriever_position / pilot_position)
 */
export function useLiveEvent(eventId: string | undefined, opts: LiveOptions = {}) {
  const wantPilots = opts.pilots ?? true;
  const wantRetrievals = opts.retrievals ?? false;
  const [store] = useState(() => new LiveStore(eventId ?? null));
  useEffect(() => {
    store.dispatch({ type: "reset", eventId: eventId ?? null });
  }, [store, eventId]);

  const eventChannel = eventId && wantPilots ? `event:${eventId}` : "";
  const retrievalChannel = eventId && wantRetrievals ? `retrievals:${eventId}` : "";

  const onMessage = useCallback(
    (msg: ServerMessage) => {
      const now = Date.now();
      if (msg.channel && msg.channel === eventChannel) {
        switch (msg.type) {
          case "subscribed":
            if (isSnapshot(msg.snapshot)) {
              store.dispatch({ type: "snapshot", snapshot: { ...msg.snapshot, cursor: msg.cursor ?? msg.snapshot.cursor }, nowMs: now, source: "ws" });
            } else if (msg.cursor) store.dispatch({ type: "cursor", cursor: msg.cursor });
            break;
          case "position":
            if (msg.data) store.enqueue({ type: "position", data: msg.data as PositionMessageData, cursor: msg.cursor, nowMs: now });
            break;
          case "flight":
            if (msg.data) store.enqueue({ type: "flight", data: msg.data as Flight, cursor: msg.cursor });
            break;
        }
        return;
      }
      if (msg.channel && msg.channel === retrievalChannel) {
        switch (msg.type) {
          case "subscribed": {
            const snap = retrievalSnapshot(msg.snapshot);
            if (snap) store.dispatch({ type: "retrievals", items: snap.items, retrievers: snap.retrievers, serverTime: snap.serverTime, nowMs: now, cursor: msg.cursor });
            break;
          }
          case "retrieval":
            if (msg.data) store.enqueue({ type: "retrieval", data: msg.data as Retrieval, cursor: msg.cursor });
            break;
          case "retriever_position":
            if (msg.data) store.enqueue({ type: "retriever_position", data: msg.data as RetrieverPositionMessageData, cursor: msg.cursor, nowMs: now });
            break;
          case "pilot_position":
            if (msg.data) store.enqueue({ type: "pilot_position", data: msg.data as PilotPositionMessageData, cursor: msg.cursor });
            break;
        }
      }
    },
    [store, eventChannel, retrievalChannel],
  );

  const channels = useMemo(() => {
    const out: ChannelSpec[] = [];
    if (eventChannel) out.push({ channel: eventChannel, since: () => store.getState().cursor });
    // The contract defines no `since` for retrievals: every (re)subscribe returns a fresh snapshot.
    if (retrievalChannel) out.push({ channel: retrievalChannel });
    return out;
  }, [eventChannel, retrievalChannel, store]);
  const rt = useRealtime(channels, onMessage, Boolean(eventId));

  const refetchInterval = rt.status === "open" ? SNAPSHOT_REFRESH_MS : SNAPSHOT_REFRESH_DEGRADED_MS;
  const snapshot = useQuery({
    queryKey: ["live", eventId],
    queryFn: ({ signal }) => eventsApi.live(eventId!, signal),
    enabled: Boolean(eventId) && wantPilots,
    refetchInterval,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const list = useQuery({
    queryKey: ["live-retrievals", eventId],
    queryFn: async ({ signal }) => ({ items: await retrievalsApi.list(eventId!, "requested,accepted,picked_up", signal), at: Date.now() }),
    enabled: Boolean(eventId) && !wantPilots && wantRetrievals,
    refetchInterval,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  useEffect(() => {
    if (snapshot.data) store.dispatch({ type: "snapshot", snapshot: snapshot.data, nowMs: Date.now(), source: "rest" });
  }, [snapshot.data, store]);
  useEffect(() => {
    if (list.data) store.dispatch({ type: "retrievals", items: list.data.items, nowMs: list.data.at });
  }, [list.data, store]);

  const state = useSyncExternalStore(store.subscribe, store.getState);
  const now = useNow(1000);
  const pilots = useMemo(() => viewPilots(state, now), [state, now]);
  const retrievers = useMemo(() => viewRetrievers(state, now), [state, now]);
  const retrievals = useMemo(() => Object.values(state.retrievals), [state.retrievals]);
  const source = wantPilots ? snapshot : list;

  return {
    store,
    pilots,
    retrievals,
    retrievers,
    state,
    now,
    connection: rt.status,
    reconnectAttempt: rt.attempt,
    snapshotError: source.error,
    isLoading: source.isLoading,
    lastSnapshotAt: source.dataUpdatedAt || null,
    refetch: source.refetch,
  };
}

export type LiveEventData = ReturnType<typeof useLiveEvent>;
