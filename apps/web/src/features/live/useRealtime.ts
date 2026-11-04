import { useEffect, useRef, useState } from "react";
import { realtimeUrl } from "@/lib/config";
import { session } from "@/lib/auth/session";
import { refreshSession } from "@/lib/api/client";
import { RealtimeClient, type ConnectionStatus, type ServerMessage } from "./realtime";

export interface ChannelSpec {
  channel: string;
  since?: () => string | null | undefined;
}

/** One WebSocket connection for the given channels; reconnects and resubscribes automatically. */
export function useRealtime(channels: ChannelSpec[], onMessage: (msg: ServerMessage) => void, enabled = true) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [attempt, setAttempt] = useState(0);
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  }, [onMessage]);
  const key = channels.map((c) => c.channel).join("|");
  const specs = useRef(channels);
  useEffect(() => {
    specs.current = channels;
  }, [channels]);

  useEffect(() => {
    if (!enabled || !key) return;
    const client = new RealtimeClient({
      url: realtimeUrl(),
      getToken: () => session.token(),
      onUnauthorized: async () => Boolean(await refreshSession()),
      onMessage: (m) => handler.current(m),
      onStatus: (s, n) => {
        setStatus(s);
        setAttempt(n);
      },
    });
    for (const c of specs.current) client.subscribe(c.channel, () => specs.current.find((x) => x.channel === c.channel)?.since?.());
    client.start();
    return () => client.stop();
  }, [key, enabled]);

  return { status, attempt };
}
