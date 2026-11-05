/**
 * Pure derivations for the operations room: pilot phases, retrieval board columns, distances and
 * per-role visibility. Kept free of React so they are unit-tested directly.
 */
import type { Member, Retrieval, RetrievalStatus } from "@/lib/api/types";
import type { LivePilotView, RetrieverView } from "./store";

/* ---------- geometry ---------- */

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Where the pilot is now as far as the retrieval knows: latest shared position, else the pickup point. */
export function pilotPoint(r: Retrieval): { lat: number; lon: number; t: string; isPickup: boolean } {
  if (r.pilot_position) return { lat: r.pilot_position.lat, lon: r.pilot_position.lon, t: r.pilot_position.t, isPickup: false };
  return { lat: r.pickup.lat, lon: r.pickup.lon, t: r.pickup.t, isPickup: true };
}

/** Retriever → pilot distance (m) for an accepted / picked-up retrieval; null when the retriever position is unknown. */
export function retrieverDistanceM(r: Retrieval, retrievers?: Record<string, RetrieverView> | RetrieverView[]): number | null {
  if (!r.retriever) return null;
  let pos: { lat: number; lon: number } | null = r.retriever_position;
  if (!pos && retrievers) {
    const list = Array.isArray(retrievers) ? retrievers : Object.values(retrievers);
    pos = list.find((x) => x.userId === r.retriever!.user_id)?.position ?? null;
  }
  return pos ? distanceM(pos, pilotPoint(r)) : null;
}

/* ---------- status / time ---------- */

export const OPEN: RetrievalStatus[] = ["requested", "accepted", "picked_up"];
export const isOpen = (r: Retrieval) => OPEN.includes(r.status);

/** Timestamp when the retrieval entered its current status. */
export function statusSince(r: Retrieval): string {
  switch (r.status) {
    case "requested": {
      // After a release the request is "requested" again; the last released/requested update is the better start.
      const rel = [...(r.updates ?? [])].reverse().find((u) => u.kind === "released");
      return rel?.created_at ?? r.requested_at;
    }
    case "accepted": return r.accepted_at ?? r.requested_at;
    case "picked_up": return r.picked_up_at ?? r.accepted_at ?? r.requested_at;
    case "delivered": return r.delivered_at ?? r.requested_at;
    case "cancelled": return r.cancelled_at ?? r.requested_at;
  }
}

/** Seconds since `iso` in server-corrected client time. */
export function secondsSince(iso: string | null | undefined, nowMs: number, clockOffsetMs = 0): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, (nowMs + clockOffsetMs - ms) / 1000);
}

/* ---------- board ---------- */

export type BoardColumn = RetrievalStatus;
export const BOARD_COLUMNS: BoardColumn[] = ["requested", "accepted", "picked_up", "delivered", "cancelled"];

/** Group retrievals into board columns. Open columns oldest-first (longest waiting on top); closed newest-first. */
export function boardColumns(retrievals: Retrieval[]): Record<BoardColumn, Retrieval[]> {
  const cols: Record<BoardColumn, Retrieval[]> = { requested: [], accepted: [], picked_up: [], delivered: [], cancelled: [] };
  for (const r of retrievals) cols[r.status]?.push(r);
  const asc = (a: Retrieval, b: Retrieval) => Date.parse(statusSince(a)) - Date.parse(statusSince(b));
  for (const c of OPEN) cols[c].sort((a, b) => Date.parse(a.requested_at) - Date.parse(b.requested_at));
  cols.delivered.sort((a, b) => -asc(a, b));
  cols.cancelled.sort((a, b) => -asc(a, b));
  return cols;
}

/* ---------- per-role visibility (defence in depth; the server filters first) ---------- */

export type Viewer =
  | { kind: "operator" }                 // organizer, observer, platform admin
  | { kind: "retriever"; userId: string } // requested ones + the ones I hold
  | { kind: "pilot"; userId: string };    // my own

export function visibleRetrievals(list: Retrieval[], viewer: Viewer): Retrieval[] {
  switch (viewer.kind) {
    case "operator":
      return list;
    case "retriever":
      return list.filter((r) => r.status === "requested" || r.retriever?.user_id === viewer.userId);
    case "pilot":
      return list.filter((r) => r.pilot.user_id === viewer.userId);
  }
}

/* ---------- pilot phases for the left rail ---------- */

export type PilotPhase = "awaiting" | "in_air" | "landed" | "retrieved" | "not_started";
export const PHASE_ORDER: PilotPhase[] = ["awaiting", "in_air", "landed", "retrieved", "not_started"];

export interface PilotRow {
  key: string;
  userId: string;
  name: string;
  publicId: string | null;
  phase: PilotPhase;
  live: LivePilotView | null;
  retrieval: Retrieval | null;
}

/**
 * One row per pilot: latest flight from the live snapshot, their most relevant retrieval
 * (open first, else the latest closed), and approved pilots with no flight yet ("not started").
 *  - awaiting  = an open retrieval (requested / accepted / picked up)
 *  - in_air    = recording flight, no open retrieval
 *  - retrieved = latest retrieval delivered
 *  - landed    = flight ended (or retrieval cancelled), no open request
 */
export function pilotRows(pilots: LivePilotView[], retrievals: Retrieval[], members: Member[] | null): PilotRow[] {
  const byUser = new Map<string, PilotRow>();
  const latestFlight = new Map<string, LivePilotView>();
  for (const p of pilots) {
    const uid = p.pilot?.user_id ?? p.flightId;
    const prev = latestFlight.get(uid);
    if (!prev || Date.parse(p.position.t) > Date.parse(prev.position.t)) latestFlight.set(uid, p);
  }
  const retrievalFor = new Map<string, Retrieval>();
  for (const r of retrievals) {
    const prev = retrievalFor.get(r.pilot.user_id);
    if (!prev) { retrievalFor.set(r.pilot.user_id, r); continue; }
    const rank = (x: Retrieval) => (isOpen(x) ? 1 : 0);
    if (rank(r) > rank(prev) || (rank(r) === rank(prev) && Date.parse(r.requested_at) > Date.parse(prev.requested_at))) {
      retrievalFor.set(r.pilot.user_id, r);
    }
  }
  const users = new Set<string>([...latestFlight.keys(), ...retrievalFor.keys()]);
  for (const m of members ?? []) if (m.role === "pilot" && m.status === "active") users.add(m.user_id);

  for (const uid of users) {
    const live = latestFlight.get(uid) ?? null;
    const r = retrievalFor.get(uid) ?? null;
    const member = members?.find((m) => m.user_id === uid);
    let phase: PilotPhase;
    if (r && isOpen(r)) phase = "awaiting";
    else if (live?.status === "recording") {
      // Still recording after delivery (app didn't end the flight) counts as retrieved, not flying.
      phase = r?.status === "delivered" && Date.parse(statusSince(r)) >= Date.parse(live.position.t) ? "retrieved" : "in_air";
    } else if (r?.status === "delivered") phase = "retrieved";
    else if (live || r) phase = "landed";
    else phase = "not_started";
    byUser.set(uid, {
      key: uid,
      userId: uid,
      name: live?.pilot?.full_name || r?.pilot.full_name || member?.full_name || "—",
      publicId: live?.pilot?.public_id ?? r?.pilot.public_id ?? member?.public_id ?? null,
      phase,
      live,
      retrieval: r,
    });
  }
  return [...byUser.values()];
}

/** tel: link from a human-formatted phone number. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
