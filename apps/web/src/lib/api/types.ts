/** Types mirroring docs/architecture/api-contract.md (v1, ADR-012). snake_case kept as on the wire. */

/** Only global role (ADR-012). */
export type GlobalRole = "platform_admin";
/** Member role inside an event (exactly one per user per event). */
export type MemberRole = "pilot" | "observer" | "retriever";
export const MEMBER_ROLES: MemberRole[] = ["pilot", "observer", "retriever"];

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
  phone: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
}

export interface Preferences {
  units: "metric" | "imperial";
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

/** GET /users/search items. */
export interface UserSearchItem {
  id: string;
  full_name: string;
  email: string;
  public_id: string | null;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export type EventStatus = "draft" | "published" | "active" | "completed" | "archived";

export interface EventSettings {
  applications_open: boolean;
  live_tracking: boolean;
  public_live_map: boolean;
  pilots_see_each_other: boolean;
  landing_prompt: boolean;
}

export type ApplicationStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface EventMe {
  is_organizer: boolean;
  role: MemberRole | null;
  application: { id: string; status: Exclude<ApplicationStatus, "approved"> } | null;
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
  organizers: { user_id: string; full_name: string }[];
  counts: { pilots: number; observers: number; retrievers: number; pending_applications?: number };
  /** Absent for guests. */
  me?: EventMe | null;
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

export interface Member {
  user_id: string;
  full_name: string;
  public_id: string | null;
  role: MemberRole | null;
  is_organizer: boolean;
  status: "active" | "removed";
  joined_at: string;
  /** Organizers only. */
  phone?: string;
}

export interface Application {
  id: string;
  event_id: string;
  user: { user_id: string; full_name: string; email: string; public_id: string | null };
  message: string;
  status: ApplicationStatus;
  granted_role: MemberRole | null;
  decided_by: { user_id: string; full_name: string } | null;
  decision_note: string;
  created_at: string;
  decided_at: string | null;
}

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

/* ---------- retrievals ---------- */

export type RetrievalStatus = "requested" | "accepted" | "picked_up" | "delivered" | "cancelled";
export const OPEN_RETRIEVAL_STATUSES: RetrievalStatus[] = ["requested", "accepted", "picked_up"];

export interface RetrievalPoint {
  lat: number;
  lon: number;
  gps_alt_m?: number | null;
  h_acc_m?: number | null;
  t: string;
}

export interface RetrievalUpdate {
  id: string;
  kind: "requested" | "accepted" | "released" | "assigned" | "picked_up" | "delivered" | "cancelled" | "note";
  actor: { user_id: string; full_name: string } | null;
  body: string;
  created_at: string;
}

export interface Retrieval {
  id: string;
  event_id: string;
  flight_id: string | null;
  pilot: { user_id: string; full_name: string; public_id: string | null; phone?: string | null };
  status: RetrievalStatus;
  pickup: RetrievalPoint;
  pilot_position: Position | null;
  note: string;
  retriever: { user_id: string; full_name: string; phone?: string | null } | null;
  retriever_position: { lat: number; lon: number; h_acc_m?: number | null; t: string } | null;
  requested_at: string;
  accepted_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  cancelled_by: { user_id: string; full_name: string } | null;
  cancel_reason: string;
  delivery_note: string;
  is_simulated: boolean;
  updates?: RetrievalUpdate[];
}

export interface RetrieverPosition {
  lat: number;
  lon: number;
  h_acc_m?: number | null;
  t: string;
  course_deg?: number | null;
  speed_ms?: number | null;
}

export interface LiveRetriever {
  user_id: string;
  full_name: string;
  on_duty: boolean;
  position: RetrieverPosition | null;
  age_s: number | null;
  active_retrievals: number;
}

export interface LiveSnapshot {
  event_id: string;
  server_time: string;
  cursor: string | null;
  pilots: LivePilot[];
  retrievals?: Retrieval[];
  retrievers?: LiveRetriever[];
}

/* ---------- notifications ---------- */

export interface NotificationItem {
  id: string;
  kind: "event_update" | "application" | "retrieval" | "flight" | "system";
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

/* ---------- admin ---------- */

/** GET /admin/stats — counters named in the contract; every field optional (we never invent a value). */
export interface AdminStats {
  generated_at?: string;
  active_events?: number;
  pilots_in_air?: number;
  stale_sessions?: number;
  open_retrievals?: number;
  pending_applications?: number;
  recent_flights?: number;
  users?: number;
  system_status?: {
    checks?: Record<string, string>;
    email_failed_24h?: number;
    email_pending?: number;
    outbox_depth?: number;
  } & Record<string, unknown>;
}

/** GET /admin/users items. The flag is read from `is_platform_admin` or, if absent, `roles`. */
export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  public_id?: string | null;
  is_platform_admin?: boolean;
  roles?: string[];
  disabled: boolean;
  disabled_at?: string | null;
  email_verified: boolean;
  must_change_password?: boolean;
  created_at: string;
}

export function isPlatformAdminUser(u: AdminUser): boolean {
  return u.is_platform_admin ?? Boolean(u.roles?.includes("platform_admin"));
}

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

/* ---------- report ---------- */

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

/** GET /events/{id}/report. Only fields present in the response are shown. */
export interface EventReport {
  event_id: string;
  generated_at: string;
  members?: Partial<Record<MemberRole | "organizers" | "removed", number>>;
  flights?: { count: number; by_status?: Partial<Record<FlightStatus, number>>; total_duration_s?: number; avg_duration_s?: number; simulated?: number };
  telemetry?: { samples: number; expected_samples: number; completeness: number | null; interruptions: number; note?: string };
  retrievals?: {
    count: number;
    by_status?: Partial<Record<RetrievalStatus, number>>;
    median_request_to_accept_s?: number | null;
    median_accept_to_pickup_s?: number | null;
    median_pickup_to_delivery_s?: number | null;
  };
  items?: EventReportFlight[];
}

export type Flyability = "good" | "marginal" | "poor" | "unknown";

export interface WeatherHour {
  t: string;
  temp_c: number | null;
  dew_point_c: number | null;
  wind_ms: number | null;
  wind_dir_deg: number | null;
  gust_ms: number | null;
  wind_850_ms: number | null;
  wind_850_dir_deg: number | null;
  cape_jkg: number | null;
  precip_prob_pct: number | null;
  cloud_cover_pct: number | null;
  cloud_base_m: number | null;
  flyability: Flyability;
  fly_reasons: string[];
}

export interface Weather {
  source: string;
  attribution: string;
  lat: number;
  lon: number;
  elevation_m: number | null;
  fetched_at: string;
  current: { t: string; temp_c: number | null; wind_ms: number | null; wind_dir_deg: number | null; gust_ms: number | null; cloud_cover_pct: number | null; precip_mm: number | null };
  hourly: WeatherHour[];
  flyability: Flyability;
  fly_reasons: string[];
}
