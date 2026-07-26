import { describe, expect, it } from "vitest";

import { nextLifecycleStatus } from "./lifecycle.js";

const startsAt = new Date("2026-08-01T08:00:00.000Z");
const endsAt = new Date("2026-08-03T18:00:00.000Z");

describe("nextLifecycleStatus", () => {
  it("activates and completes a published event at its boundaries", () => {
    expect(nextLifecycleStatus("published", startsAt, endsAt, startsAt)).toBe("active");
    expect(nextLifecycleStatus("active", startsAt, endsAt, endsAt)).toBe("completed");
  });

  it("does not mutate draft or cancelled events", () => {
    expect(nextLifecycleStatus("draft", startsAt, endsAt, endsAt)).toBe("draft");
    expect(nextLifecycleStatus("cancelled", startsAt, endsAt, endsAt)).toBe("cancelled");
  });
});
