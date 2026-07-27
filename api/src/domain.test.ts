import { describe, expect, it } from "vitest";

import { eventInputSchema, trackPointSchema } from "./domain.js";

describe("eventInputSchema", () => {
  it("accepts a valid event window", () => {
    const event = eventInputSchema.parse({
      name: "XC Open 2026 Çameli",
      venue: "Çameli",
      startsAt: "2026-08-10T06:00:00+03:00",
      endsAt: "2026-08-12T19:00:00+03:00",
    });
    expect(event.visibility).toBe("public");
  });

  it("rejects an end before the start", () => {
    expect(() => eventInputSchema.parse({
      name: "Invalid event",
      venue: "Çameli",
      startsAt: "2026-08-12T19:00:00+03:00",
      endsAt: "2026-08-10T06:00:00+03:00",
    })).toThrow();
  });
});

describe("trackPointSchema", () => {
  it("accepts normalized pilot telemetry", () => {
    expect(trackPointSchema.parse({
      sequence: 1,
      recordedAt: Date.now(),
      latitude: 36.99,
      longitude: 29.23,
      accuracy: 8,
      altitude: 1350,
      altitudeAccuracy: 12,
      speed: 14,
      heading: 180,
      batteryLevel: 0.72,
      isCharging: false,
      connectivity: "online",
    }).sequence).toBe(1);
  });

  it("rejects impossible telemetry", () => {
    expect(() => trackPointSchema.parse({
      sequence: 1,
      recordedAt: Date.now(),
      latitude: 120,
      longitude: 29.23,
      accuracy: -1,
      altitude: null,
      altitudeAccuracy: null,
      speed: 500,
      heading: null,
      batteryLevel: 2,
      isCharging: null,
      connectivity: "online",
    })).toThrow();
  });
});
