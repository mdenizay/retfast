import {
  createEventInputSchema,
  ingestTrackBatchInputSchema,
  startTrackingSessionInputSchema,
  updateEventInputSchema,
} from "@retfast/domain";
import { describe, expect, it } from "vitest";

describe("event command schemas", () => {
  it("loads safely at runtime and validates event boundaries", () => {
    const event = {
      name: "XC Open 2026 Çameli",
      venue: "Çameli",
      startsAt: "2026-08-01T08:00:00.000Z",
      endsAt: "2026-08-03T18:00:00.000Z",
    };
    expect(createEventInputSchema.safeParse(event).success).toBe(true);
    expect(updateEventInputSchema.safeParse({ eventId: "event-1", name: "Updated" }).success).toBe(true);
  });
});

describe("tracking command schemas", () => {
  const point = {
    sequence: 10,
    recordedAt: 1_785_088_800_000,
    latitude: 37.071,
    longitude: 29.344,
    accuracy: 7.5,
    altitude: 1_422,
    altitudeAccuracy: 11,
    speed: 13.4,
    heading: 242,
    batteryLevel: 0.78,
    isCharging: false,
    connectivity: "online",
  };

  it("accepts a bounded, ordered batch", () => {
    expect(
      startTrackingSessionInputSchema.safeParse({
        eventId: "event-1",
        deviceId: "device-12345678",
      }).success,
    ).toBe(true);
    expect(
      ingestTrackBatchInputSchema.safeParse({
        eventId: "event-1",
        sessionId: "session-1",
        batchId: "batch_00000001",
        points: [point, { ...point, sequence: 11, recordedAt: point.recordedAt + 10_000 }],
      }).success,
    ).toBe(true);
  });

  it("rejects unordered points and invalid coordinates", () => {
    expect(
      ingestTrackBatchInputSchema.safeParse({
        eventId: "event-1",
        sessionId: "session-1",
        batchId: "batch_00000001",
        points: [point, { ...point, latitude: 91 }],
      }).success,
    ).toBe(false);
  });
});
