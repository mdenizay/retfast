// Etkinlik canlı bağlantısı: WS + tam durum (snapshot). Platformdan bağımsız (web, React Native).
//
// Strateji: konum çerçeveleri yerinde uygulanır; operasyon olayları gelince durum kısa bir
// gecikmeyle sunucudan yeniden çekilir. İş kuralları istemcide tekrarlanmaz, durum hiç sapmaz.
import type { Client } from "./api";
import type { LiveSnapshot, OpEvent, Position, Uuid } from "./types";

export interface LiveState extends Omit<LiveSnapshot, "positions"> {
  positions: Record<Uuid, Position>;
  /** Sunucu saatiyle yerel saat farkı (ms). Bayatlık hesabında kullanılır. */
  clockSkew: number;
}

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";

export interface LiveOptions {
  client: Client;
  eventId: Uuid;
  /** ws(s)://…/v1 */
  wsBase: string;
  /** React Native gibi başlık destekleyen ortamlar için. Tarayıcı cookie kullanır. */
  token?: () => string | null | undefined;
  onState: (s: LiveState) => void;
  onStatus?: (s: ConnectionStatus) => void;
  onEvent?: (e: OpEvent) => void;
  /** Kalıcı olmayan (seq'siz) olaylar: ör. `flight.suggestion`. */
  onTransient?: (e: { t: string; subject?: Uuid; d?: Record<string, unknown> }) => void;
}

export function connectLive(opts: LiveOptions): () => void {
  let state: LiveState | null = null;
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let refetchTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSeq = 0;
  // Bağlantı sağlam görünse de dakikada bir tam durumla yakınsa (güvenlik ağı).
  const safety = setInterval(() => void refetch(), 60_000);

  const emit = () => state && opts.onState(state);

  async function refetch() {
    try {
      const snap = await opts.client.events.live(opts.eventId);
      const positions: Record<Uuid, Position> = {};
      for (const p of snap.positions) positions[p.u] = p;
      // Snapshot'tan sonra WS ile gelmiş daha yeni konumları koru.
      if (state) for (const [u, p] of Object.entries(state.positions)) if (!positions[u] || positions[u].t < p.t) positions[u] = p;
      lastSeq = Math.max(lastSeq, snap.last_seq);
      state = { ...snap, positions, clockSkew: snap.server_time - Date.now() };
      emit();
    } catch {
      /* sonraki olay veya güvenlik ağı yeniden dener */
    }
  }

  function scheduleRefetch(delay = 250) {
    if (refetchTimer) return;
    refetchTimer = setTimeout(() => {
      refetchTimer = null;
      void refetch();
    }, delay);
  }

  function open() {
    if (closed) return;
    opts.onStatus?.(attempt === 0 ? "connecting" : "reconnecting");
    const url = `${opts.wsBase}/events/${opts.eventId}/ws`;
    const token = opts.token?.();
    // RN WebSocket üçüncü parametrede başlık kabul eder; tarayıcıda yok sayılır.
    ws = token
      ? new (WebSocket as unknown as new (u: string, p: undefined, o: { headers: Record<string, string> }) => WebSocket)(url, undefined, { headers: { authorization: `Bearer ${token}` } })
      : new WebSocket(url);
    ws.onmessage = (m) => {
      let f: { t: string; seq?: number; d?: unknown };
      try {
        f = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (f.t === "hello") {
        attempt = 0;
        opts.onStatus?.("live");
        void refetch();
      } else if (f.t === "positions") {
        if (!state) return;
        const positions = { ...state.positions };
        for (const p of f.d as Position[]) if (!positions[p.u] || positions[p.u]!.t <= p.t) positions[p.u] = p;
        state = { ...state, positions };
        emit();
      } else if (f.t === "resync") {
        void refetch();
      } else if (typeof f.seq === "number") {
        if (f.seq <= lastSeq) return; // snapshot zaten içeriyor
        lastSeq = f.seq;
        opts.onEvent?.(f as OpEvent);
        scheduleRefetch();
      } else {
        // seq'siz geçici olay (tracking.started/stopped, flight.suggestion)
        opts.onTransient?.(f as { t: string; subject?: Uuid; d?: Record<string, unknown> });
        scheduleRefetch(1000);
      }
    };
    ws.onclose = () => {
      ws = null;
      if (closed) return;
      opts.onStatus?.(attempt > 3 ? "offline" : "reconnecting");
      const delay = Math.min(15_000, 1000 * 2 ** attempt) * (0.7 + Math.random() * 0.6);
      attempt++;
      reconnectTimer = setTimeout(open, delay);
    };
    ws.onerror = () => ws?.close();
  }

  open();
  return () => {
    closed = true;
    clearInterval(safety);
    if (refetchTimer) clearTimeout(refetchTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}

/** Konumun yaşı (ms), sunucu saatine göre. */
export function positionAge(p: Position, state: Pick<LiveState, "clockSkew">, now = Date.now()): number {
  return now + state.clockSkew - p.t;
}

export type Freshness = "live" | "stale" | "lost";

/** 60 sn'ye kadar canlı, 5 dk'ya kadar bayat, sonrası kayıp. */
export function freshness(ageMs: number): Freshness {
  return ageMs < 60_000 ? "live" : ageMs < 300_000 ? "stale" : "lost";
}
