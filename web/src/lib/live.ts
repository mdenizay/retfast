import { useEffect, useState } from "react";

import type { Connectivity, TrackingRole } from "../domain";
import { apiRequest, authenticatedSocket } from "./api";

export type LiveParticipant = {
  sessionId: string; userId: string; role: TrackingRole; displayName: string;
  radioCallsign: string | null; latitude: number; longitude: number;
  accuracy: number | null; altitude: number | null; speed: number | null;
  heading: number | null; batteryLevel: number | null; isCharging: boolean | null;
  connectivity: Connectivity; recordedAt: number; receivedAt: number;
  online: boolean; lastDisconnectedAt?: number | null;
};

export function useLiveParticipants(eventId: string | undefined, enabled: boolean) {
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!eventId || !enabled) return;
    let active = true;
    let socket: WebSocket | undefined;
    const load = async () => {
      try {
        const data = await apiRequest<{ participants: LiveParticipant[] }>(`/v1/events/${eventId}/live`);
        if (active) setParticipants(data.participants);
      } catch (loadError) { if (active) setError(String(loadError)); }
      finally { if (active) setLoading(false); }
    };
    void load();
    const poll = setInterval(() => void load(), 15_000);
    void authenticatedSocket().then((nextSocket) => {
      if (!active) { nextSocket.close(); return; }
      socket = nextSocket;
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; data?: LiveParticipant };
        if (message.type === "authenticated") socket?.send(JSON.stringify({ type: "subscribe", eventId }));
        else if (message.type === "subscribed") setConnected(true);
        else if (message.type === "location.updated" && message.data) {
          setParticipants((current) => [...current.filter((item) => item.userId !== message.data!.userId), message.data!]);
        } else if (message.type === "tracking.stopped") void load();
      });
      socket.addEventListener("close", () => setConnected(false));
    }).catch((socketError) => setError(String(socketError)));
    return () => { active = false; clearInterval(poll); socket?.close(); };
  }, [enabled, eventId]);
  return { participants: enabled ? participants : [], connected: enabled && connected, loading: enabled && loading, error: enabled ? error : null };
}
