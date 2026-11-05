import { describe, expect, it } from "vitest";
import { initialLiveState, liveReducer, mergeRetrieval, viewPilots, viewRetrievers } from "./store";
import { boardColumns, distanceM, pilotRows, retrieverDistanceM, statusSince, visibleRetrievals } from "./derive";
import { livePilot, liveRetriever, member, position, retrieval, snapshot } from "@/test/fixtures";

const NOW = Date.parse("2026-11-04T10:00:03.000Z");

describe("liveReducer: retrievals", () => {
  it("loads retrievals and retrievers from the /live snapshot", () => {
    const s = liveReducer(initialLiveState("e-1"), {
      type: "snapshot", nowMs: NOW, source: "rest",
      snapshot: snapshot({ retrievals: [retrieval()], retrievers: [liveRetriever({ age_s: 40 })] }),
    });
    expect(s.retrievalsKnown).toBe(true);
    expect(s.retrievals["r-1"]!.status).toBe("requested");
    const [r] = viewRetrievers(s, NOW);
    expect(r!.ageS).toBe(40);
    expect(r!.freshness).toBe("stale");
  });

  it("a snapshot without `retrievals` (e.g. guest) leaves retrieval state unknown", () => {
    const s = liveReducer(initialLiveState("e-1"), { type: "snapshot", snapshot: snapshot(), nowMs: NOW, source: "rest" });
    expect(s.retrievalsKnown).toBe(false);
  });

  it("applies `retrieval` pushes and never regresses to an older copy", () => {
    let s = liveReducer(initialLiveState("e-1"), { type: "retrieval", data: retrieval(), cursor: "r-5" });
    const accepted = retrieval({
      status: "accepted", accepted_at: "2026-11-04T10:02:00.000Z",
      retriever: { user_id: "u-5", full_name: "Kübra Alıcı", phone: "+90 555 999" },
    });
    s = liveReducer(s, { type: "retrieval", data: accepted, cursor: "r-6" });
    expect(s.retrievals["r-1"]!.status).toBe("accepted");
    expect(s.retrievalCursor).toBe("r-6");
    // An older REST snapshot arrives late: the accepted state wins.
    s = liveReducer(s, { type: "snapshot", nowMs: NOW, source: "rest", snapshot: snapshot({ server_time: "2026-11-04T10:01:00.000Z", retrievals: [retrieval()] }) });
    expect(s.retrievals["r-1"]!.status).toBe("accepted");
  });

  it("drops retrievals missing from an authoritative list unless they changed after it", () => {
    let s = liveReducer(initialLiveState("e-1"), { type: "retrieval", data: retrieval({ id: "old" }) });
    s = liveReducer(s, { type: "retrieval", data: retrieval({ id: "fresh", requested_at: "2026-11-04T10:05:00.000Z", updates: [] }) });
    s = liveReducer(s, { type: "retrievals", items: [], nowMs: NOW, serverTime: "2026-11-04T10:03:00.000Z" });
    expect(s.retrievals.old).toBeUndefined();
    expect(s.retrievals.fresh).toBeDefined();
  });

  it("ignores pushes for other events", () => {
    const s = liveReducer(initialLiveState("e-1"), { type: "retrieval", data: retrieval({ event_id: "e-2" }) });
    expect(s.retrievals["r-1"]).toBeUndefined();
  });

  it("retriever_position updates the retriever and the open retrievals they hold", () => {
    let s = liveReducer(initialLiveState("e-1"), {
      type: "retrieval",
      data: retrieval({ status: "accepted", accepted_at: "2026-11-04T10:01:00.000Z", retriever: { user_id: "u-5", full_name: "Kübra" } }),
    });
    s = liveReducer(s, {
      type: "retriever_position", nowMs: NOW,
      data: { user_id: "u-5", full_name: "Kübra", position: { lat: 37.051, lon: 29.301, h_acc_m: 8, t: "2026-11-04T10:02:00.000Z" } },
    });
    expect(s.retrievers["u-5"]!.position!.lat).toBe(37.051);
    expect(s.retrievals["r-1"]!.retriever_position!.lat).toBe(37.051);
    // older fix is ignored
    s = liveReducer(s, {
      type: "retriever_position", nowMs: NOW,
      data: { user_id: "u-5", full_name: "Kübra", position: { lat: 1, lon: 1, t: "2026-11-04T09:00:00.000Z" } },
    });
    expect(s.retrievers["u-5"]!.position!.lat).toBe(37.051);
  });

  it("pilot_position updates the retrieval's pilot position by seq", () => {
    let s = liveReducer(initialLiveState("e-1"), { type: "retrieval", data: retrieval() });
    s = liveReducer(s, { type: "pilot_position", data: { retrieval_id: "r-1", user_id: "u-2", position: position({ seq: 50, lat: 37.049 }) } });
    s = liveReducer(s, { type: "pilot_position", data: { retrieval_id: "r-1", user_id: "u-2", position: position({ seq: 49, lat: 1 }) } });
    expect(s.retrievals["r-1"]!.pilot_position!.lat).toBe(37.049);
    // unknown retrieval: no-op
    const same = liveReducer(s, { type: "pilot_position", data: { retrieval_id: "nope", user_id: "u-2", position: position() } });
    expect(same.retrievals).toBe(s.retrievals);
  });

  it("merge keeps a phone number we already had when a later copy omits it", () => {
    const a = retrieval();
    const b = retrieval({ pilot: { ...a.pilot, phone: undefined }, status: "accepted", accepted_at: "2026-11-04T10:01:00.000Z" });
    expect(mergeRetrieval(a, b).pilot.phone).toBe(a.pilot.phone);
  });
});

describe("derive", () => {
  it("visibility per role: operators all, retrievers requested + own, pilots own", () => {
    const list = [
      retrieval({ id: "a" }),
      retrieval({ id: "b", status: "accepted", retriever: { user_id: "u-5", full_name: "K" } }),
      retrieval({ id: "c", status: "accepted", retriever: { user_id: "u-6", full_name: "X" }, pilot: { user_id: "u-3", full_name: "B", public_id: null } }),
    ];
    expect(visibleRetrievals(list, { kind: "operator" }).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(visibleRetrievals(list, { kind: "retriever", userId: "u-5" }).map((r) => r.id)).toEqual(["a", "b"]);
    expect(visibleRetrievals(list, { kind: "pilot", userId: "u-3" }).map((r) => r.id)).toEqual(["c"]);
  });

  it("board columns: open ones longest-waiting first, closed newest first", () => {
    const cols = boardColumns([
      retrieval({ id: "new", requested_at: "2026-11-04T10:05:00.000Z" }),
      retrieval({ id: "old", requested_at: "2026-11-04T09:50:00.000Z" }),
      retrieval({ id: "d1", status: "delivered", delivered_at: "2026-11-04T09:00:00.000Z" }),
      retrieval({ id: "d2", status: "delivered", delivered_at: "2026-11-04T09:30:00.000Z" }),
      retrieval({ id: "x", status: "cancelled", cancelled_at: "2026-11-04T09:30:00.000Z" }),
    ]);
    expect(cols.requested.map((r) => r.id)).toEqual(["old", "new"]);
    expect(cols.delivered.map((r) => r.id)).toEqual(["d2", "d1"]);
    expect(cols.cancelled).toHaveLength(1);
  });

  it("statusSince uses the release time for re-opened requests", () => {
    const r = retrieval({
      updates: [
        { id: "1", kind: "requested", actor: null, body: "", created_at: "2026-11-04T10:00:00.000Z" },
        { id: "2", kind: "released", actor: null, body: "", created_at: "2026-11-04T10:07:00.000Z" },
      ],
    });
    expect(statusSince(r)).toBe("2026-11-04T10:07:00.000Z");
  });

  it("distance retriever → pilot prefers the pilot's live position over the pickup point", () => {
    const base = retrieval({ status: "accepted", retriever: { user_id: "u-5", full_name: "K" }, retriever_position: { lat: 37.05, lon: 29.31, t: "2026-11-04T10:00:00.000Z" } });
    const d1 = retrieverDistanceM(base)!;
    expect(Math.round(d1)).toBe(Math.round(distanceM({ lat: 37.05, lon: 29.31 }, base.pickup)));
    const moved = { ...base, pilot_position: position({ lat: 37.05, lon: 29.31 }) };
    expect(retrieverDistanceM(moved)).toBeLessThan(1);
    expect(retrieverDistanceM(retrieval())).toBeNull();
  });

  it("pilot rows: phases from flights, retrievals and approved pilots without a flight", () => {
    const s = liveReducer(initialLiveState("e-1"), {
      type: "snapshot", nowMs: NOW, source: "rest",
      snapshot: snapshot({
        pilots: [
          livePilot({ flight_id: "f-1" }),
          livePilot({ flight_id: "f-2", status: "ended", pilot: { user_id: "u-3", full_name: "Burak", public_id: null } }),
          livePilot({ flight_id: "f-3", status: "ended", pilot: { user_id: "u-4", full_name: "Cem", public_id: null } }),
        ],
      }),
    });
    const rows = pilotRows(
      viewPilots(s, NOW),
      [
        retrieval({ pilot: { user_id: "u-3", full_name: "Burak", public_id: null } }),
        retrieval({ id: "r-2", status: "delivered", delivered_at: "2026-11-04T10:30:00.000Z", pilot: { user_id: "u-4", full_name: "Cem", public_id: null } }),
      ],
      [member({ user_id: "u-8", full_name: "Deniz", role: "pilot" }), member({ user_id: "u-9", full_name: "Obs", role: "observer" })],
    );
    const phase = Object.fromEntries(rows.map((r) => [r.name, r.phase]));
    expect(phase).toEqual({ "Ayşe Kaya": "in_air", Burak: "awaiting", Cem: "retrieved", Deniz: "not_started" });
  });
});
