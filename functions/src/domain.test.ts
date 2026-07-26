import { createEventInputSchema, updateEventInputSchema } from "@retfast/domain";
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
