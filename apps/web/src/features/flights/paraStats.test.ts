import { describe, expect, it } from "vitest";
import type { Position } from "@/lib/api/types";
import { paraStats } from "./paraStats";

const t0 = Date.UTC(2026, 10, 5, 10, 0, 0);
function pos(i: number, alt: number, lat = 37.7 + i * 0.0001): Position {
  return { id: String(i), seq: i, t: new Date(t0 + i * 1000).toISOString(), received_at: new Date(t0 + i * 1000).toISOString(),
    lat, lon: 29.1, gps_alt_m: alt, h_acc_m: 5, v_acc_m: null, speed_ms: 10, course_deg: 0 } as Position;
}

describe("paraStats", () => {
  it("returns null for too few points", () => {
    expect(paraStats([pos(0, 1000)])).toBeNull();
  });

  it("finds a thermal between glides", () => {
    const ps: Position[] = [];
    let alt = 1300;
    for (let i = 0; i < 300; i++) {
      alt += i < 60 ? -1 : i < 180 ? 2 : -1.2; // glide, 120 s at +2 m/s, glide
      ps.push(pos(i, alt));
    }
    const s = paraStats(ps)!;
    expect(s.climbCount).toBe(1);
    expect(s.bestClimbAvg).toBeGreaterThan(1.5);
    expect(s.maxClimb).toBeCloseTo(2, 0);
    expect(s.maxSink).toBeLessThan(-0.9);
    expect(s.climbingShare).toBeGreaterThan(0.35);
    expect(s.climbingShare).toBeLessThan(0.45);
    expect(s.takeoffAlt).toBe(1299);
    expect(s.straightDistance).toBeGreaterThan(3000);
    expect(s.maxFromTakeoff).toBeCloseTo(s.straightDistance, -1);
  });

  it("ignores short bumps", () => {
    const ps = Array.from({ length: 120 }, (_, i) => pos(i, 1300 - i + (i >= 50 && i < 60 ? (i - 50) * 3 : 0)));
    expect(paraStats(ps)!.climbCount).toBe(0);
  });
});
