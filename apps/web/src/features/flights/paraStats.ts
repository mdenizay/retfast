import type { Position } from "@/lib/api/types";
import { distanceM } from "@/features/live/derive";

/**
 * Paragliding-oriented flight summary computed from a track. Same rules as the
 * iOS FlightTrack: GPS-derived vario over a centred 8 s window, climbs of at
 * least 30 s averaging > 0.5 m/s count as thermals.
 */
export interface ParaStats {
  maxClimb: number | null;
  maxSink: number | null;
  avgSpeed: number | null;
  straightDistance: number;
  maxFromTakeoff: number;
  climbingShare: number;
  climbCount: number;
  bestClimbAvg: number | null;
  takeoffAlt: number | null;
  landingAlt: number | null;
}

interface Pt { t: number; lat: number; lon: number; alt: number | null; vario: number | null }

export function paraStats(positions: Position[]): ParaStats | null {
  const good = positions.filter((p) => (p.h_acc_m ?? Infinity) <= 50);
  const src = good.length >= Math.max(2, positions.length / 2) ? good : positions;
  const pts: Pt[] = [];
  for (const p of [...src].sort((a, b) => Date.parse(a.t) - Date.parse(b.t))) {
    const t = Date.parse(p.t) / 1000;
    if (pts.length && t <= pts[pts.length - 1]!.t) continue;
    pts.push({ t, lat: p.lat, lon: p.lon, alt: p.gps_alt_m ?? null, vario: null });
  }
  if (pts.length < 2) return null;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < pts.length; i++) {
    while (pts[lo]!.t < pts[i]!.t - 4) lo++;
    while (hi + 1 < pts.length && pts[hi + 1]!.t <= pts[i]!.t + 4) hi++;
    const dt = pts[hi]!.t - pts[lo]!.t;
    const a = pts[hi]!.alt;
    const b = pts[lo]!.alt;
    if (dt >= 2 && a !== null && b !== null) pts[i]!.vario = (a - b) / dt;
  }
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const duration = last.t - first.t;
  let dist = 0;
  let maxFrom = 0;
  for (let i = 1; i < pts.length; i++) {
    dist += distanceM(pts[i - 1]!, pts[i]!);
    maxFrom = Math.max(maxFrom, distanceM(first, pts[i]!));
  }
  const varios = pts.map((p) => p.vario).filter((v): v is number => v !== null);
  const alts = pts.filter((p) => p.alt !== null);

  let climbing = 0;
  let climbCount = 0;
  let best: number | null = null;
  let segStart: number | null = null;
  const close = (end: number) => {
    if (segStart === null) return;
    const dt = pts[end]!.t - pts[segStart]!.t;
    const a = pts[end]!.alt;
    const b = pts[segStart]!.alt;
    if (dt >= 30 && a !== null && b !== null) {
      const avg = (a - b) / dt;
      if (avg > 0.5) {
        climbCount++;
        best = Math.max(best ?? 0, avg);
      }
    }
    segStart = null;
  };
  for (let i = 1; i < pts.length; i++) {
    const v = pts[i]!.vario ?? 0;
    if (v > 0.3) {
      climbing += pts[i]!.t - pts[i - 1]!.t;
      if (segStart === null) segStart = i;
    } else if (v < -0.2) close(i - 1);
  }
  close(pts.length - 1);

  return {
    maxClimb: varios.length ? Math.max(...varios) : null,
    maxSink: varios.length ? Math.min(...varios) : null,
    avgSpeed: duration > 0 ? dist / duration : null,
    straightDistance: distanceM(first, last),
    maxFromTakeoff: maxFrom,
    climbingShare: duration > 0 ? climbing / duration : 0,
    climbCount,
    bestClimbAvg: best,
    takeoffAlt: alts[0]?.alt ?? null,
    landingAlt: alts[alts.length - 1]?.alt ?? null,
  };
}
