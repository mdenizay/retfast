import { describe, expect, it } from "vitest";

import {
  canTransitionRetrieval,
  haversineKilometres,
} from "./retrieval-state.js";

describe("retrieval matching utilities", () => {
  it("orders nearby vehicles using great-circle distance", () => {
    const distance = haversineKilometres(
      { latitude: 37.071, longitude: 29.344 },
      { latitude: 37.081, longitude: 29.344 },
    );
    expect(distance).toBeGreaterThan(1);
    expect(distance).toBeLessThan(1.2);
  });

  it("allows only operationally valid transitions", () => {
    expect(canTransitionRetrieval("assigned", "picked_up")).toBe(true);
    expect(canTransitionRetrieval("picked_up", "delivered")).toBe(true);
    expect(canTransitionRetrieval("delivered", "assigned")).toBe(false);
    expect(canTransitionRetrieval("searching", "delivered")).toBe(false);
  });
});
