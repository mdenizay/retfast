/**
 * WebSocket client for /api/v1/realtime (api-contract "Realtime WebSocket").
 * - auth message first (guests skip), then (re)subscribe every channel with its last cursor
 * - replies pong to server ping; closes a connection that is silent for 60 s
 * - reconnects with exponential backoff 1 s → 30 s with jitter
 * - close 4001 → asks the app to refresh the access token before reconnecting
 */
export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface ServerMessage {
  type: string;
  channel?: string;
  cursor?: string;
  data?: unknown;
  snapshot?: unknown;
  code?: string;
  user_id?: string;
}

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface RealtimeOptions {
  url: string;
  getToken: () => string | null;
  /** Called on close 4001 / auth error; should refresh and resolve with whether a token is available. */
  onUnauthorized?: () => Promise<boolean>;
  onMessage: (msg: ServerMessage) => void;
  onStatus?: (status: ConnectionStatus, attempt: number) => void;
  createSocket?: (url: string) => WebSocketLike;
  random?: () => number;
  minDelayMs?: number;
  maxDelayMs?: number;
  silenceTimeoutMs?: number;
}

export function backoffDelay(attempt: number, random: () => number, min = 1000, max = 30000): number {
  const base = Math.min(max, min * 2 ** Math.max(0, attempt - 1));
  // "Equal jitter": half fixed, half random — never 0, never above `max`.
  return Math.round(base / 2 + random() * (base / 2));
}

const OPEN = 1;

/** Default socket factory; tests swap it via setSocketFactory. */
let socketFactory: (url: string) => WebSocketLike = (url) => new WebSocket(url) as unknown as WebSocketLike;
export function setSocketFactory(f: (url: string) => WebSocketLike) {
  socketFactory = f;
}

export class RealtimeClient {
  private ws: WebSocketLike | null = null;
  private channels = new Map<string, () => string | null | undefined>();
  private attempt = 0;
  private status: ConnectionStatus = "idle";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private authed = false;
  private readonly opts: Required<Omit<RealtimeOptions, "onUnauthorized" | "onStatus">> &
    Pick<RealtimeOptions, "onUnauthorized" | "onStatus">;

  constructor(opts: RealtimeOptions) {
    this.opts = {
      createSocket: (url) => socketFactory(url),
      random: Math.random,
      minDelayMs: 1000,
      maxDelayMs: 30000,
      silenceTimeoutMs: 60000,
      ...opts,
    };
  }

  get connectionStatus() {
    return this.status;
  }
  get reconnectAttempt() {
    return this.attempt;
  }

  /** Register a channel; `since` is read at (re)subscribe time so reconnects resume from the latest cursor. */
  subscribe(channel: string, since: () => string | null | undefined = () => null) {
    this.channels.set(channel, since);
    if (this.ws && this.ws.readyState === OPEN && this.canSubscribe()) this.sendSubscribe(channel);
  }

  unsubscribe(channel: string) {
    this.channels.delete(channel);
    if (this.ws && this.ws.readyState === OPEN) this.send({ type: "unsubscribe", channel });
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onopen = null;
      try {
        ws.close(1000, "client stop");
      } catch {
        /* ignore */
      }
    }
    this.setStatus("closed");
  }

  /** Force a reconnect (e.g. after the access token was refreshed). */
  reconnectNow() {
    if (this.stopped) return;
    this.ws?.close(4000, "reconnect");
  }

  private canSubscribe() {
    return this.authed || !this.opts.getToken();
  }

  private setStatus(s: ConnectionStatus) {
    this.status = s;
    this.opts.onStatus?.(s, this.attempt);
  }

  private clearTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.reconnectTimer = null;
    this.silenceTimer = null;
  }

  private armSilence() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      // Server pings every 25 s; 60 s of silence means the connection is dead.
      try {
        this.ws?.close(4000, "silent");
      } catch {
        /* ignore */
      }
    }, this.opts.silenceTimeoutMs);
  }

  private send(msg: unknown) {
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(JSON.stringify(msg));
  }

  private sendSubscribe(channel: string) {
    const since = this.channels.get(channel)?.();
    this.send(since ? { type: "subscribe", channel, since } : { type: "subscribe", channel });
  }

  private subscribeAll() {
    for (const ch of this.channels.keys()) this.sendSubscribe(ch);
  }

  private connect() {
    if (this.stopped) return;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    let ws: WebSocketLike;
    try {
      ws = this.opts.createSocket(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.authed = false;

    ws.onopen = () => {
      this.armSilence();
      const token = this.opts.getToken();
      if (token) this.send({ type: "auth", access_token: token });
      else this.subscribeAll();
    };

    ws.onmessage = (ev) => {
      this.armSilence();
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "ping") {
        this.send({ type: "pong" });
        return;
      }
      if (msg.type === "auth_ok") {
        this.authed = true;
        this.attempt = 0;
        this.setStatus("open");
        this.subscribeAll();
        return;
      }
      if (msg.type === "subscribed") {
        if (this.status !== "open") {
          this.attempt = 0;
          this.setStatus("open");
        }
      }
      if (msg.type === "error" && msg.code === "unauthorized" && !msg.channel) {
        ws.close(4001, "unauthorized");
        return;
      }
      this.opts.onMessage(msg);
    };

    ws.onerror = () => {
      /* onclose follows */
    };

    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      if (this.stopped) return;
      if (ev.code === 4001 && this.opts.onUnauthorized) {
        this.attempt += 1;
        this.setStatus("reconnecting");
        void this.opts.onUnauthorized().finally(() => this.scheduleReconnect(true));
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(alreadyCounted = false) {
    if (this.stopped) return;
    if (!alreadyCounted) this.attempt += 1;
    this.setStatus("reconnecting");
    const delay = backoffDelay(this.attempt, this.opts.random, this.opts.minDelayMs, this.opts.maxDelayMs);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
