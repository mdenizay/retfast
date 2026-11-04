import { describe, expect, it } from "vitest";
import { LiveStore, initialLiveState, liveReducer, viewPilots, estimateVario, TRAIL_MAX_POINTS } from "./store";
import { freshnessFor, ageSeconds } from "./freshness";
import { flight, livePilot, position, snapshot } from "@/test/fixtures";

const NOW = Date.parse("2026-11-04T10:00:03.000Z");

describe("freshness", () => {
  it("classifies by the contract thresholds (live < 30 s, stale ≤ 5 min, lost > 5 min)", () => {
    expect(freshnessFor(0)).toBe("live");
    expect(freshnessFor(29.9)).toBe("live");
    expect(freshnessFor(30)).toBe("stale");
    expect(freshnessFor(300)).toBe("stale");
    expect(freshnessFor(300.1)).toBe("lost");
    expect(freshnessFor(Number.NaN)).toBe("lost");
  });
  it("never reports negative ages", () => {
    expect(ageSeconds(NOW + 5000, NOW)).toBe(0);
    expect(ageSeconds(NOW - 12_000, NOW)).toBe(12);
  });
});

describe("liveReducer: snapshot", () => {
  it("loads pilots, derives receive time from age_s and keeps the cursor", () => {
    const s = liveReducer(initialLiveState("e-1"), { type: "snapshot", snapshot: snapshot({ pilots: [livePilot({ age_s: 40 })] }), nowMs: NOW, source: "rest" });
    expect(s.cursor).toBe("100-0");
    const [p] = viewPilots(s, NOW);
    expect(p!.ageS).toBe(40);
    expect(p!.freshness).toBe("stale");
    // age keeps ticking with the clock
    expect(viewPilots(s, NOW + 270_000)[0]!.freshness).toBe("lost");
  });

  it("computes the server clock offset so a skewed browser clock doesn't distort ages", () => {
    const skewedNow = NOW - 120_000; // browser 2 min behind
    let s = liveReducer(initialLiveState("e-1"), { type: "snapshot", snapshot: snapshot(), nowMs: skewedNow, source: "rest" });
    expect(s.clockOffsetMs).toBe(120_000);
    s = liveReducer(s, {
      type: "position",
      data: { flight_id: "f-2", pilot: { user_id: "u-3", full_name: "B", public_id: null }, is_simulated: false, position: position({ seq: 1, received_at: "2026-11-04T10:00:03.000Z" }) },
      nowMs: skewedNow,
    });
    expect(viewPilots(s, skewedNow).find((p) => p.flightId === "f-2")!.ageS).toBe(0);
  });

  it("does not regress a pilot to an older snapshot position, and drops pilots no longer visible", () => {
    let s = liveReducer(initialLiveState("e-1"), {
      type: "snapshot", snapshot: snapshot({ pilots: [livePilot(), livePilot({ flight_id: "f-2" })] }), nowMs: NOW, source: "rest",
    });
    s = liveReducer(s, { type: "position", data: { flight_id: "f-1", pilot: livePilot().pilot, is_simulated: false, position: position({ seq: 5, lat: 37.1 }) }, nowMs: NOW, cursor: "105-0" });
    s = liveReducer(s, { type: "snapshot", snapshot: snapshot({ cursor: "101-0", pilots: [livePilot({ position: position({ seq: 3 }) })] }), nowMs: NOW, source: "rest" });
    expect(s.pilots["f-1"]!.position.seq).toBe(5);
    expect(s.pilots["f-2"]).toBeUndefined();
    // REST snapshot must not move the stream cursor backwards
    expect(s.cursor).toBe("105-0");
  });

  it("a WS subscribed snapshot is the source of truth for the cursor", () => {
    let s = liveReducer(initialLiveState("e-1"), { type: "cursor", cursor: "200-0" });
    s = liveReducer(s, { type: "snapshot", snapshot: snapshot({ cursor: "150-0" }), nowMs: NOW, source: "ws" });
    expect(s.cursor).toBe("150-0");
  });
});

describe("liveReducer: position / flight messages", () => {
  const base = () => liveReducer(initialLiveState("e-1"), { type: "snapshot", snapshot: snapshot(), nowMs: NOW, source: "rest" });

  it("merges newer positions, appends to the trail and advances the cursor", () => {
    const s = liveReducer(base(), {
      type: "position", cursor: "101-0", nowMs: NOW,
      data: { flight_id: "f-1", pilot: livePilot().pilot, is_simulated: false, position: position({ seq: 2, t: "2026-11-04T10:00:12.000Z", gps_alt_m: 2120, received_at: "2026-11-04T10:00:03.000Z" }) },
    });
    expect(s.cursor).toBe("101-0");
    expect(s.pilots["f-1"]!.position.seq).toBe(2);
    expect(s.pilots["f-1"]!.trail).toHaveLength(2);
    expect(s.pilots["f-1"]!.varioEstimate).toBeCloseTo(20 / 12, 3);
  });

  it("ignores duplicates / out-of-order replays but still records the cursor", () => {
    const s1 = base();
    const s2 = liveReducer(s1, { type: "position", cursor: "102-0", nowMs: NOW, data: { flight_id: "f-1", pilot: livePilot().pilot, is_simulated: false, position: position({ seq: 1 }) } });
    expect(s2.pilots).toBe(s1.pilots);
    expect(s2.cursor).toBe("102-0");
  });

  it("adds pilots that appear only on the socket", () => {
    const s = liveReducer(base(), { type: "position", nowMs: NOW, data: { flight_id: "f-9", pilot: { user_id: "u-9", full_name: "Yeni", public_id: null }, is_simulated: true, position: position({ seq: 1 }) } });
    expect(s.pilots["f-9"]!.isSimulated).toBe(true);
  });

  it("caps the trail length", () => {
    let s = base();
    for (let i = 2; i < TRAIL_MAX_POINTS + 50; i++) {
      s = liveReducer(s, { type: "position", nowMs: NOW, data: { flight_id: "f-1", pilot: livePilot().pilot, is_simulated: false, position: position({ seq: i, t: new Date(Date.parse("2026-11-04T10:00:00.000Z") + i * 1000).toISOString() }) } });
    }
    expect(s.pilots["f-1"]!.trail.length).toBe(TRAIL_MAX_POINTS);
  });

  it("applies flight status changes and removes abandoned flights", () => {
    let s = liveReducer(base(), { type: "flight", data: flight({ status: "ended" }), cursor: "103-0" });
    expect(s.pilots["f-1"]!.status).toBe("ended");
    expect(s.cursor).toBe("103-0");
    s = liveReducer(s, { type: "flight", data: flight({ status: "abandoned" }) });
    expect(s.pilots["f-1"]).toBeUndefined();
  });
});

describe("estimateVario", () => {
  it("returns null without altitude or with a single point", () => {
    expect(estimateVario([[0, 0, 100, 0]])).toBeNull();
    expect(estimateVario([[0, 0, null, 0], [0, 0, 100, 20_000]])).toBeNull();
  });
});

describe("LiveStore batching", () => {
  it("coalesces queued messages into a single notification per frame", () => {
    let flushFn: (() => void) | null = null;
    const store = new LiveStore("e-1", (fn) => { flushFn = fn; });
    store.dispatch({ type: "snapshot", snapshot: snapshot(), nowMs: NOW, source: "rest" });
    let notified = 0;
    store.subscribe(() => notified++);
    for (let i = 2; i <= 6; i++) {
      store.enqueue({ type: "position", nowMs: NOW, data: { flight_id: "f-1", pilot: livePilot().pilot, is_simulated: false, position: position({ seq: i }) } });
    }
    expect(notified).toBe(0);
    flushFn!();
    expect(notified).toBe(1);
    expect(store.getState().pilots["f-1"]!.position.seq).toBe(6);
  });
});
