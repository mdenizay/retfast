import { describe, expect, it } from "vitest";

import { mergeRouteChunks, type ReplayPoint } from "./replay";

function point(sequence: number, recordedAt: number): ReplayPoint {
  return {
    sequence,
    recordedAt,
    latitude: 37 + sequence / 1_000,
    longitude: 29,
    accuracy: 5,
    altitude: 1_000 + sequence,
    altitudeAccuracy: 8,
    speed: 10,
    heading: 180,
    batteryLevel: 0.8,
    isCharging: false,
    connectivity: "online",
  };
}

describe("replay route assembly", () => {
  it("sorts chunks and removes retry overlap by sequence", () => {
    const merged = mergeRouteChunks([
      { points: [point(3, 3_000), point(4, 4_000)] },
      { points: [point(1, 1_000), point(2, 2_000), point(3, 3_000)] },
    ]);
    expect(merged.map((item) => item.sequence)).toEqual([1, 2, 3, 4]);
  });
});
