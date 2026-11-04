import type { Position } from "@/lib/api/types";

export const POOR_FIX_M = 50; // server-side stats skip samples with h_acc_m > 50 (api-contract)

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i]!;
}

export function gpsQuality(positions: Position[]) {
  const acc = positions.map((p) => p.h_acc_m).filter((v): v is number => typeof v === "number" && v > 0).sort((a, b) => a - b);
  const poor = acc.filter((v) => v > POOR_FIX_M).length;
  return {
    medianAcc: quantile(acc, 0.5),
    p95Acc: quantile(acc, 0.95),
    poorRatio: acc.length ? poor / acc.length : null,
  };
}

/** Evenly downsample to at most `max` points, always keeping first and last. */
export function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = (items.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]!);
  return out;
}
