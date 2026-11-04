/**
 * Live tracking state: pure reducer (unit-tested) + a small external store that batches
 * high-frequency WebSocket messages into one render per animation frame.
 *
 * Clock handling: the server reports `server_time` and `received_at` in its own clock. We keep an
 * offset (server − client) from the latest snapshot and convert every received_at into client time,
 * so ages tick correctly even if the browser clock is wrong.
 */
import type { Flight, FlightStatus, LivePilot, LiveSnapshot, PilotRef, Position, TrailPoint } from "@/lib/api/types";
import { ageSeconds, freshnessFor } from "./freshness";

export const TRAIL_WINDOW_MS = 15 * 60 * 1000;
export const TRAIL_MAX_POINTS = 300;

export interface LivePilotState {
  flightId: string;
  pilot: PilotRef;
  isSimulated: boolean;
  status: FlightStatus;
  position: Position;
  /** Last received time in *client* clock (ms). */
  receivedAtMs: number;
  trail: TrailPoint[];
  /** Vertical speed estimate from the last two trail points (m/s), null if not derivable. */
  varioEstimate: number | null;
}

export interface LiveState {
  eventId: string | null;
  cursor: string | null;
  /** server clock − client clock (ms). */
  clockOffsetMs: number;
  pilots: Record<string, LivePilotState>;
  snapshotAtMs: number | null;
}

export interface PositionMessageData {
  flight_id: string;
  pilot: PilotRef;
  is_simulated: boolean;
  position: Position;
}

export type LiveAction =
  | { type: "snapshot"; snapshot: LiveSnapshot; nowMs: number; source: "rest" | "ws" }
  | { type: "position"; data: PositionMessageData; cursor?: string | null; nowMs: number }
  | { type: "flight"; data: Flight; cursor?: string | null }
  | { type: "cursor"; cursor: string }
  | { type: "reset"; eventId: string | null };

export const initialLiveState = (eventId: string | null = null): LiveState => ({
  eventId,
  cursor: null,
  clockOffsetMs: 0,
  pilots: {},
  snapshotAtMs: null,
});

function toClient(serverIso: string, offset: number, fallback: number): number {
  const ms = Date.parse(serverIso);
  return Number.isFinite(ms) ? ms - offset : fallback;
}

function trimTrail(trail: TrailPoint[], latestMs: number): TrailPoint[] {
  const cutoff = latestMs - TRAIL_WINDOW_MS;
  let out = trail;
  if (out.length && out[0]![3] < cutoff) out = out.filter((p) => p[3] >= cutoff);
  if (out.length > TRAIL_MAX_POINTS) out = out.slice(out.length - TRAIL_MAX_POINTS);
  return out;
}

export function estimateVario(trail: TrailPoint[]): number | null {
  if (trail.length < 2) return null;
  // Use a ~10 s+ baseline to dampen GPS altitude noise.
  const last = trail[trail.length - 1]!;
  for (let i = trail.length - 2; i >= 0; i--) {
    const p = trail[i]!;
    const dt = (last[3] - p[3]) / 1000;
    if (dt >= 10 || i === 0) {
      if (dt <= 0 || last[2] == null || p[2] == null) return null;
      if (dt > 120) return null;
      return (last[2] - p[2]) / dt;
    }
  }
  return null;
}

function pointOf(p: Position): TrailPoint {
  return [p.lon, p.lat, p.gps_alt_m, Date.parse(p.t)];
}

function fromSnapshotPilot(lp: LivePilot, nowMs: number): LivePilotState {
  const trail = [...(lp.trail ?? [])].sort((a, b) => a[3] - b[3]);
  const last = trail[trail.length - 1];
  const posT = Date.parse(lp.position.t);
  if (!last || (Number.isFinite(posT) && last[3] < posT)) trail.push(pointOf(lp.position));
  return {
    flightId: lp.flight_id,
    pilot: lp.pilot,
    isSimulated: Boolean(lp.is_simulated),
    status: lp.status,
    position: lp.position,
    // Prefer the server-computed age: robust against both clocks.
    receivedAtMs: nowMs - Math.max(0, lp.age_s ?? 0) * 1000,
    trail,
    varioEstimate: estimateVario(trail),
  };
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case "reset":
      return initialLiveState(action.eventId);

    case "snapshot": {
      const { snapshot, nowMs } = action;
      const serverMs = Date.parse(snapshot.server_time);
      const clockOffsetMs = Number.isFinite(serverMs) ? serverMs - nowMs : state.clockOffsetMs;
      const pilots: Record<string, LivePilotState> = {};
      for (const lp of snapshot.pilots) {
        const next = fromSnapshotPilot(lp, nowMs);
        const prev = state.pilots[lp.flight_id];
        // A snapshot can be older than positions already streamed over the socket: keep the newer one.
        if (prev && prev.position.seq > next.position.seq) {
          pilots[lp.flight_id] = { ...prev, status: next.status, pilot: next.pilot, isSimulated: next.isSimulated };
        } else {
          pilots[lp.flight_id] = next;
        }
      }
      // Pilots missing from the snapshot are no longer visible to us (ended long ago or visibility changed).
      const cursor =
        action.source === "ws" ? (snapshot.cursor ?? state.cursor) : (state.cursor ?? snapshot.cursor ?? null);
      return { ...state, eventId: snapshot.event_id ?? state.eventId, cursor, clockOffsetMs, pilots, snapshotAtMs: nowMs };
    }

    case "position": {
      const { data, nowMs } = action;
      const cursor = action.cursor ?? state.cursor;
      const prev = state.pilots[data.flight_id];
      const p = data.position;
      if (prev && p.seq <= prev.position.seq) {
        // Duplicate or out-of-order replay: keep state, but still advance the cursor.
        return cursor === state.cursor ? state : { ...state, cursor };
      }
      const receivedAtMs = Math.min(nowMs, toClient(p.received_at, state.clockOffsetMs, nowMs));
      const pt = pointOf(p);
      const baseTrail = prev?.trail ?? [];
      const trail = trimTrail(
        baseTrail.length && baseTrail[baseTrail.length - 1]![3] > pt[3]
          ? [...baseTrail, pt].sort((a, b) => a[3] - b[3])
          : [...baseTrail, pt],
        Math.max(pt[3], baseTrail[baseTrail.length - 1]?.[3] ?? 0),
      );
      const next: LivePilotState = {
        flightId: data.flight_id,
        pilot: data.pilot ?? prev?.pilot,
        isSimulated: Boolean(data.is_simulated),
        status: prev?.status ?? "recording",
        position: p,
        receivedAtMs,
        trail,
        varioEstimate: estimateVario(trail),
      };
      return { ...state, cursor, pilots: { ...state.pilots, [data.flight_id]: next } };
    }

    case "flight": {
      const f = action.data;
      const cursor = action.cursor ?? state.cursor;
      const prev = state.pilots[f.id];
      if (f.status === "abandoned" || (state.eventId && f.event_id && f.event_id !== state.eventId)) {
        if (!prev) return { ...state, cursor };
        const rest = { ...state.pilots };
        delete rest[f.id];
        return { ...state, cursor, pilots: rest };
      }
      if (!prev) {
        if (!f.last_position) return { ...state, cursor };
        const receivedAtMs = toClient(f.last_received_at ?? f.last_position.received_at, state.clockOffsetMs, Date.now());
        const trail = [pointOf(f.last_position)];
        return {
          ...state,
          cursor,
          pilots: {
            ...state.pilots,
            [f.id]: {
              flightId: f.id, pilot: f.pilot, isSimulated: f.is_simulated, status: f.status,
              position: f.last_position, receivedAtMs, trail, varioEstimate: null,
            },
          },
        };
      }
      return {
        ...state,
        cursor,
        pilots: { ...state.pilots, [f.id]: { ...prev, status: f.status, isSimulated: f.is_simulated, pilot: f.pilot ?? prev.pilot } },
      };
    }

    case "cursor":
      return action.cursor === state.cursor ? state : { ...state, cursor: action.cursor };
  }
}

/* ---------- derived view ---------- */

export interface LivePilotView extends LivePilotState {
  ageS: number;
  freshness: ReturnType<typeof freshnessFor>;
}

export function viewPilots(state: LiveState, nowMs: number): LivePilotView[] {
  return Object.values(state.pilots).map((p) => {
    const ageS = ageSeconds(p.receivedAtMs, nowMs);
    return { ...p, ageS, freshness: freshnessFor(ageS) };
  });
}

/* ---------- external store with frame batching ---------- */

export class LiveStore {
  private state: LiveState;
  private listeners = new Set<() => void>();
  private queue: LiveAction[] = [];
  private scheduled = false;
  private readonly schedule: (fn: () => void) => void;

  constructor(eventId: string | null, schedule?: (fn: () => void) => void) {
    this.state = initialLiveState(eventId);
    this.schedule =
      schedule ??
      ((fn) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => fn()) : setTimeout(fn, 16)));
  }

  getState = (): LiveState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Apply immediately (snapshots, user-visible resets). */
  dispatch(action: LiveAction) {
    this.flush();
    this.apply([action]);
  }

  /** Queue high-frequency actions; flushed once per frame. */
  enqueue(action: LiveAction) {
    this.queue.push(action);
    if (!this.scheduled) {
      this.scheduled = true;
      this.schedule(() => this.flush());
    }
  }

  flush() {
    this.scheduled = false;
    if (!this.queue.length) return;
    const q = this.queue;
    this.queue = [];
    this.apply(q);
  }

  private apply(actions: LiveAction[]) {
    let s = this.state;
    for (const a of actions) s = liveReducer(s, a);
    if (s !== this.state) {
      this.state = s;
      for (const l of this.listeners) l();
    }
  }
}
