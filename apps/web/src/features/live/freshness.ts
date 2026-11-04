import { FRESHNESS } from "@/lib/config";
import type { Freshness } from "@/lib/api/types";

/** live < 30 s, stale 30 s – 5 min, lost > 5 min since last received position (api-contract "Live data"). */
export function freshnessFor(ageSeconds: number): Freshness {
  if (!Number.isFinite(ageSeconds)) return "lost";
  if (ageSeconds < FRESHNESS.liveSeconds) return "live";
  if (ageSeconds <= FRESHNESS.lostSeconds) return "stale";
  return "lost";
}

/** Age in seconds of a position received at `receivedAtClientMs` (client clock), never negative. */
export function ageSeconds(receivedAtClientMs: number, nowMs: number): number {
  return Math.max(0, (nowMs - receivedAtClientMs) / 1000);
}
