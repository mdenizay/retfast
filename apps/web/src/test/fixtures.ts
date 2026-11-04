import type { AuthResponse, Flight, Incident, LivePilot, LiveSnapshot, Me, Position, RfEvent } from "@/lib/api/types";

export function me(over: Partial<Me> = {}): Me {
  return {
    id: "u-1", email: "deniz@retfast.com", email_verified: true, full_name: "Deniz Ay",
    roles: ["pilot"], must_change_password: false, created_at: "2026-11-01T00:00:00.000Z", pilot: null,
    preferences: { units: "metric", default_flight_visibility: "event", public_profile: false },
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
    settings: { registration_open: true, live_tracking: true, flight_recording: true, observers_allowed: true, emergency_testing: true, public_live_map: true },
    organizer: { id: "u-9", full_name: "Org" }, participant_count: 3, my_role: null,
    created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z", ...over,
  };
}

export function flight(over: Partial<Flight> = {}): Flight {
  return {
    id: "f-1", public_id: "abc123", pilot: { user_id: "u-2", full_name: "Ayşe Kaya", public_id: "ayse" }, event_id: "e-1",
    status: "recording", visibility: "event", is_simulated: false, started_at: "2026-11-04T09:00:00.000Z", ended_at: null,
    last_position: position(), last_received_at: "2026-11-04T10:00:01.000Z",
    stats: { duration_s: 3600, distance_m: 12000, max_gps_alt_m: 2400, min_gps_alt_m: 900, max_ground_speed_ms: 15, total_ascent_m: 1500, total_descent_m: 400, sample_count: 3500, expected_sample_count: 3600, gap_count: 1 },
    device: { platform: "ios", app_version: "1.0.0" }, ...over,
  };
}

export function incident(over: Partial<Incident> = {}): Incident {
  return {
    id: "i-1", kind: "sos", is_test: false, status: "open",
    pilot: { user_id: "u-2", full_name: "Ayşe Kaya", public_id: "ayse", emergency_contact_name: "Mehmet Kaya", emergency_contact_phone: "+90 555 000 00 00", blood_type: "A+" },
    flight_id: null, event_id: "e-1", position: { lat: 37.07, lon: 29.34, gps_alt_m: 1500, h_acc_m: 8, t: "2026-11-04T10:00:00.000Z" },
    last_known_position: null, message: "Ağaca takıldım", created_at_device: "2026-11-04T10:00:00.000Z", received_at: "2026-11-04T10:00:02.000Z",
    acknowledged_at: null, acknowledged_by: null, resolved_at: null, assignments: [],
    updates: [{ id: "up-1", kind: "created", actor: null, body: "", status: "open", created_at: "2026-11-04T10:00:02.000Z" }],
    ...over,
  };
}
