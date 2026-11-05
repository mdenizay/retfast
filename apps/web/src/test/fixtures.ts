import type {
  Application, AuthResponse, Flight, LivePilot, LiveRetriever, LiveSnapshot, Me, Member, Position, Retrieval, RfEvent,
} from "@/lib/api/types";

export function me(over: Partial<Me> = {}): Me {
  return {
    id: "u-1", email: "deniz@retfast.com", email_verified: true, full_name: "Deniz Ay",
    roles: [], must_change_password: false, created_at: "2026-11-01T00:00:00.000Z", pilot: null,
    preferences: { units: "metric", public_profile: false },
    ...over,
  };
}

export function auth(user: Me = me(), token = "access-1"): AuthResponse {
  return {
    access_token: token,
    access_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    user,
  };
}

export function position(over: Partial<Position> = {}): Position {
  return {
    id: `p-${over.seq ?? 1}`, seq: 1, t: "2026-11-04T10:00:00.000Z", received_at: "2026-11-04T10:00:01.000Z",
    lat: 37.07, lon: 29.34, gps_alt_m: 2100, h_acc_m: 5, v_acc_m: null, speed_ms: 9.8, course_deg: 212, ...over,
  };
}

export function livePilot(over: Partial<LivePilot> = {}): LivePilot {
  return {
    flight_id: "f-1", pilot: { user_id: "u-2", full_name: "Ayşe Kaya", public_id: "ayse" }, is_simulated: false,
    status: "recording", position: position(), age_s: 2, freshness: "live", trail: [], ...over,
  };
}

export function snapshot(over: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return { event_id: "e-1", server_time: "2026-11-04T10:00:03.000Z", cursor: "100-0", pilots: [livePilot()], ...over };
}

export function event(over: Partial<RfEvent> = {}): RfEvent {
  return {
    id: "e-1", slug: "cameli-paragliding-demo", name: "Çameli Demo", description: "", kind: "paragliding",
    status: "active", is_demo: true, visibility: "public", location_name: "Çameli, Denizli",
    center: { lat: 37.07, lon: 29.34 }, center_is_approximate: true,
    starts_at: "2026-11-04T06:00:00.000Z", ends_at: "2026-11-06T16:00:00.000Z", cover_image_url: null,
    settings: { applications_open: true, live_tracking: true, public_live_map: true, pilots_see_each_other: true, landing_prompt: true },
    organizers: [{ user_id: "u-9", full_name: "Org Kişi" }],
    counts: { pilots: 3, observers: 1, retrievers: 1 },
    me: null,
    created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z", ...over,
  };
}

/** Event as seen by a member with the given role (organizer = is_organizer, no member role). */
export function eventAs(role: "organizer" | "pilot" | "observer" | "retriever" | null, over: Partial<RfEvent> = {}): RfEvent {
  return event({
    me: { is_organizer: role === "organizer", role: role === "organizer" ? null : role, application: null },
    counts: role === "organizer" ? { pilots: 3, observers: 1, retrievers: 1, pending_applications: 2 } : { pilots: 3, observers: 1, retrievers: 1 },
    ...over,
  });
}

export function flight(over: Partial<Flight> = {}): Flight {
  return {
    id: "f-1", public_id: "abc123", pilot: { user_id: "u-2", full_name: "Ayşe Kaya", public_id: "ayse" }, event_id: "e-1",
    status: "recording", is_simulated: false, started_at: "2026-11-04T09:00:00.000Z", ended_at: null,
    last_position: position(), last_received_at: "2026-11-04T10:00:01.000Z",
    stats: { duration_s: 3600, distance_m: 12000, max_gps_alt_m: 2400, min_gps_alt_m: 900, max_ground_speed_ms: 15, total_ascent_m: 1500, total_descent_m: 400, sample_count: 3500, expected_sample_count: 3600, gap_count: 1 },
    device: { platform: "ios", app_version: "1.0.0" }, ...over,
  };
}

export function retrieval(over: Partial<Retrieval> = {}): Retrieval {
  return {
    id: "r-1", event_id: "e-1", flight_id: "f-1",
    pilot: { user_id: "u-2", full_name: "Ayşe Kaya", public_id: "ayse", phone: "+90 555 111 22 33" },
    status: "requested",
    pickup: { lat: 37.05, lon: 29.3, gps_alt_m: 900, h_acc_m: 6, t: "2026-11-04T10:00:00.000Z" },
    pilot_position: null,
    note: "Yol kenarındayım, kanat toplandı",
    retriever: null, retriever_position: null,
    requested_at: "2026-11-04T10:00:00.000Z", accepted_at: null, picked_up_at: null, delivered_at: null, cancelled_at: null,
    cancelled_by: null, cancel_reason: "", delivery_note: "", is_simulated: false,
    updates: [{ id: "ru-1", kind: "requested", actor: { user_id: "u-2", full_name: "Ayşe Kaya" }, body: "", created_at: "2026-11-04T10:00:00.000Z" }],
    ...over,
  };
}

export function liveRetriever(over: Partial<LiveRetriever> = {}): LiveRetriever {
  return {
    user_id: "u-5", full_name: "Kübra Alıcı", on_duty: true,
    position: { lat: 37.06, lon: 29.32, h_acc_m: 10, t: "2026-11-04T10:00:00.000Z" }, age_s: 5, active_retrievals: 0, ...over,
  };
}

export function member(over: Partial<Member> = {}): Member {
  return {
    user_id: "u-2", full_name: "Ayşe Kaya", public_id: "ayse", role: "pilot", is_organizer: false, status: "active",
    joined_at: "2026-11-02T00:00:00.000Z", phone: "+90 555 111 22 33", ...over,
  };
}

export function application(over: Partial<Application> = {}): Application {
  return {
    id: "a-1", event_id: "e-1", user: { user_id: "u-7", full_name: "Emre Can", email: "emre@example.com", public_id: "emre" },
    message: "Arabam var, alım yapabilirim.", status: "pending", granted_role: null,
    decided_by: null, decision_note: "", created_at: "2026-11-04T08:00:00.000Z", decided_at: null, ...over,
  };
}
