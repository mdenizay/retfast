import { connectLive, type ConnectionStatus, type LiveState } from '@retfast/core';
import { useEffect, useRef, useState } from 'react';
import { WS_URL, api, getToken } from './api';

/** Etkinliğin canlı durumu (WebSocket + snapshot; yeniden bağlanma ve eşitleme core paketindedir). */
export type Suggestion = 'takeoff' | 'landing';

export function useLive(eventId: string, enabled = true, meId?: string) {
  const [live, setLive] = useState<LiveState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const me = useRef(meId);
  me.current = meId;
  useEffect(() => {
    if (!enabled) return;
    return connectLive({
      client: api, eventId, wsBase: WS_URL, token: getToken, onState: setLive, onStatus: setStatus,
      // Sunucu GPS'ten kalkış/iniş tahmini üretirse yalnızca ilgili pilota öneri gelir; durum kendiliğinden değişmez.
      onTransient: (e) => {
        const kind = e.d?.kind;
        if (e.t === 'flight.suggestion' && e.subject === me.current && (kind === 'takeoff' || kind === 'landing')) setSuggestion(kind);
      },
    });
  }, [eventId, enabled]);
  return { live, status, suggestion, clearSuggestion: () => setSuggestion(null) };
}
