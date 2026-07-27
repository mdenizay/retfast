import { getAuth } from "@react-native-firebase/auth";
import { useEffect, useState } from "react";

import { apiRequest, apiWebSocketUrl } from "../lib/api";
import type { LiveParticipant } from "./types";

export function useLiveEvent(eventId: string | undefined, enabled: boolean) {
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!eventId || !enabled) return;
    let active = true;
    let socket: WebSocket | undefined;
    const load = async () => {
      try {
        const data = await apiRequest<{ participants: LiveParticipant[] }>(`/v1/events/${eventId}/live`);
        if (active) setParticipants(data.participants);
      } finally { if (active) setLoading(false); }
    };
    void load();
    const poll = setInterval(() => void load(), 15_000);
    void getAuth().currentUser?.getIdToken().then((token) => {
      if (!active || !token) return;
      socket = new WebSocket(apiWebSocketUrl());
      socket.onopen = () => socket?.send(JSON.stringify({ type: "authenticate", token }));
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; eventId?: string; data?: LiveParticipant };
        if (message.type === "authenticated") {
          socket?.send(JSON.stringify({ type: "subscribe", eventId }));
        } else if (message.type === "subscribed") {
          setConnected(true);
        } else if (message.type === "location.updated" && message.data) {
          setParticipants((current) => [
            ...current.filter((participant) => participant.userId !== message.data!.userId),
            message.data!,
          ]);
        } else if (message.type === "tracking.stopped") {
          void load();
        }
      };
      socket.onerror = () => setConnected(false);
      socket.onclose = () => setConnected(false);
    });
    return () => {
      active = false;
      clearInterval(poll);
      socket?.close();
    };
  }, [enabled, eventId]);

  return { participants: enabled ? participants : [], connected: enabled && connected, loading: enabled && loading };
}
