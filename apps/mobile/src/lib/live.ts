import { connectLive, type ConnectionStatus, type LiveState } from '@retfast/core';
import { useEffect, useState } from 'react';
import { WS_URL, api, getToken } from './api';

/** Etkinliğin canlı durumu (WebSocket + snapshot; yeniden bağlanma ve eşitleme core paketindedir). */
export function useLive(eventId: string, enabled = true) {
  const [live, setLive] = useState<LiveState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  useEffect(() => {
    if (!enabled) return;
    return connectLive({ client: api, eventId, wsBase: WS_URL, token: getToken, onState: setLive, onStatus: setStatus });
  }, [eventId, enabled]);
  return { live, status };
}
