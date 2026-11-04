/** Types mirroring docs/architecture/api-contract.md (v1). snake_case kept as on the wire. */

export type GlobalRole = "pilot" | "observer" | "event_organizer" | "rescue_operator" | "platform_admin";
export type EventRole = "organizer" | "participant" | "observer";

export interface Page<T> {
  items: T[];
  next_cursor?: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, string> };
}

export interface PilotProfile {
  public_id: string;
  display_name: string;
  bio: string;
  wing: string;
  license_no: string;
  nationality: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  blood_type: string;
}

export interface Preferences {
  units: "metric" | "imperial";
  default_flight_visibility: FlightVisibility;
  public_profile: boolean;
}

export interface Me {
  id: string;
  email: string;
  email_verified: boolean;
  full_name: string;
  roles: GlobalRole[];
  must_change_password: boolean;
  created_at: string;
  pilot: PilotProfile | null;
  preferences: Preferences;
}

export interface AuthResponse {
  access_token: string;
  access_expires_at: string;
  refresh_token?: string;
  refresh_expires_at: string;
  user: Me;
}

export interface PublicPilot {
  public_id: string;
  display_name: string;
  bio?: string;
  wing?: string;
  nationality?: string;
}

export interface PilotListItem {
  id: string;
  full_name: string;
  public_id: string | null;
  roles: GlobalRole[];
}

export interface LatLon {
  lat: number;
  lon: number;
}

export type EventStatus = "draft" | "published" | "active" | "completed" | "archived";

export interface EventSettings {
  registration_open: boolean;
  live_tracking: boolean;
  flight_recording: boolean;
  observers_allowed: boolean;
  emergency_testing: boolean;
  public_live_map: boolean;
}

export interface RfEvent {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: string;
  status: EventStatus;
  is_demo: boolean;
  visibility: "public" | "restricted";
  location_name: string;
  center: LatLon | null;
  center_is_approximate: boolean;
  starts_at: string;
  ends_at: string;
  cover_image_url: string | null;
  settings: EventSettings;
  organizer: { id: string; full_name: string } | null;
  participant_count: number;
  my_role: EventRole | null;
  created_at: string;
  updated_at: string;
}

export interface LaunchSite {
  id: string;
  event_id: string;
  name: string;
  position: LatLon | null;
  elevation_m: number | null;
  notes: string;
  is_verified: boolean;
}

export interface Participant {
  user_id: string;
  full_name: string;
  public_id: string | null;
  role: EventRole;
  status: "active" | "removed";
  joined_at: string;
}

export type FlightVisibility = "private" | "event" | "public";
export type FlightStatus = "recording" | "ended" | "abandoned";

export interface Position {
  id: string;
  seq: number;
  t: string;
  received_at: string;
  lat: number;
  lon: number;
  gps_alt_m: number | null;
  h_acc_m: number | null;
  v_acc_m: number | null;
  speed_ms: number | null;
  course_deg: number | null;
}

export interface PilotRef {
  user_id: string;
  full_name: string;
  public_id: string | null;
}

export interface FlightStats {
  duration_s: number;
  distance_m: number;
  max_gps_alt_m: number | null;
  min_gps_alt_m: number | null;
  max_ground_speed_ms: number | null;
  total_ascent_m: number;
  total_descent_m: number;
  sample_count: number;
  expected_sample_count: number;
  gap_count: number;
}

export interface Flight {
  id: string;
  public_id: string;
  pilot: PilotRef;
  event_id: string | null;
  status: FlightStatus;
  visibility: FlightVisibility;
  is_simulated: boolean;
  started_at: string;
  ended_at: string | null;
  last_position: Position | null;
  last_received_at: string | null;
  stats: FlightStats;
  device: { platform: string; app_version: string } | null;
}

export type Freshness = "live" | "stale" | "lost";

/** [lon, lat, gps_alt_m, t_unix_ms] */
export type TrailPoint = [number, number, number | null, number];

export interface LivePilot {
  flight_id: string;
  pilot: PilotRef;
  is_simulated: boolean;
  status: FlightStatus;
  position: Position;
  age_s: number;
  freshness: Freshness;
  trail: TrailPoint[];
}

export interface LiveSnapshot {
  event_id: string;
  server_time: string;
  cursor: string | null;
  pilots: LivePilot[];
}

export type IncidentStatus = "open" | "acknowledged" | "responding" | "resolved" | "cancelled";

export interface IncidentPilot extends PilotRef {
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  blood_type?: string | null;
}

export interface IncidentUpdate {
  id: string;
  kind: "created" | "acknowledged" | "status_changed" | "note" | "assigned" | "assignment_status" | "position";
  actor: { user_id: string; full_name: string } | null;
  body: string;
  status: string;
  created_at: string;
}

export type AssignmentStatus = "assigned" | "en_route" | "on_scene" | "completed" | "withdrawn";

export interface Assignment {
  id: string;
  incident_id: string;
  responder: { user_id: string; full_name: string };
  status: AssignmentStatus;
  assigned_at: string;
  updated_at: string;
  last_position: { lat: number; lon: number; t: string } | null;
}

export interface Incident {
  id: string;
  kind: "sos";
  is_test: boolean;
  status: IncidentStatus;
  pilot: IncidentPilot;
  flight_id: string | null;
  event_id: string | null;
  position: { lat: number; lon: number; gps_alt_m: number | null; h_acc_m: number | null; t: string } | null;
  last_known_position: Position | null;
  message: string;
  created_at_device: string;
  received_at: string;
  acknowledged_at: string | null;
  acknowledged_by: { user_id: string; full_name: string } | null;
  resolved_at: string | null;
  assignments: Assignment[];
  updates: IncidentUpdate[];
}

export interface RescueTeamMember {
  user_id: string;
  full_name: string;
  availability: "available" | "unavailable";
  last_position: { lat: number; lon: number; t: string } | null;
  active_assignment: Assignment | null;
}

/** GET /admin/stats (as implemented by services/api; contract lists the counters by name only). */
export interface AdminStats {
  generated_at?: string;
  active_events?: number;
  tracking_pilots?: number;
  stale_sessions?: number;
  open_incidents?: number;
  recent_flights?: number;
  users?: number;
  system_status?: {
    checks?: Record<string, string>;
    email_failed_24h?: number;
    email_pending?: number;
    outbox_depth?: number;
  } & Record<string, unknown>;
}

/** GET /admin/users items (as implemented by services/api). */
export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  public_id?: string | null;
  roles: GlobalRole[];
  disabled: boolean;
  disabled_at?: string | null;
  email_verified: boolean;
  must_change_password?: boolean;
  created_at: string;
}

/** GET /admin/audit items (as implemented by services/api). */
export interface AuditEntry {
  id: string;
  actor: { user_id: string; full_name: string } | null;
  actor_id?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  event_id?: string | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
  created_at: string;
}

/** GET /events/{id}/report (as implemented by services/api). */
export interface EventReportFlight {
  flight_id: string;
  pilot_id: string;
  pilot_name: string;
  status: FlightStatus;
  is_simulated: boolean;
  duration_s: number;
  sample_count: number;
  expected_sample_count: number;
  telemetry_completeness: number | null;
  interruptions: number;
  distance_m: number;
  max_gps_alt_m: number | null;
}

export interface EventReport {
  event_id: string;
  generated_at: string;
  participation: { participants: number; observers: number; organizers: number; removed: number; pilots_flown: number };
  flights: { count: number; by_status: Partial<Record<FlightStatus, number>>; total_duration_s: number; avg_duration_s: number };
  telemetry: { samples: number; expected_samples: number; completeness: number | null; interruptions: number; note?: string };
  items: EventReportFlight[];
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}
