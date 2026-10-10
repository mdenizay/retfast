// API sözleşmesinin TS karşılığı. Kaynak: docs/02-api-ve-yetki.md ve server/src/routes.

export type Uuid = string;
export type Locale = "en" | "tr";
export type EventStatus = "draft" | "published" | "active" | "completed" | "archived";
export type Role = "event_admin" | "pilot" | "retriever" | "observer";
export type ApplicationStatus = "pending" | "accepted" | "rejected" | "cancelled";
export type PilotState =
  | "preparing" | "flying" | "landed" | "awaiting_retrieve" | "retriever_assigned" | "picked_up" | "completed";
export type RetrieveStatus = "open" | "assigned" | "arrived" | "picked_up" | "completed" | "cancelled";
export type PointKind = "takeoff" | "landing" | "alt_landing" | "emergency_landing" | "meeting" | "hazard";
export type ZoneKind = "boundary" | "hazard" | "flight_area";

export interface User {
  id: Uuid;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  country: string | null;
  locale: Locale;
  avatar_url: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  is_system_admin: boolean;
  location_consent_at: string | null;
}

export interface EventSummary {
  id: Uuid;
  slug: string;
  name: string;
  description?: string;
  image_url: string | null;
  starts_at: string;
  ends_at: string;
  country: string | null;
  city: string | null;
  region?: string | null;
  center_lat?: number | null;
  center_lon?: number | null;
  status: EventStatus;
}

export interface EventPoint {
  id: Uuid;
  kind: PointKind;
  name: string;
  lat: number;
  lon: number;
  altitude_m: number | null;
  description: string;
  instructions: string;
}

export interface EventZone {
  id: Uuid;
  kind: ZoneKind;
  name: string;
  geojson: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
}

export interface Vehicle {
  id: Uuid;
  name: string;
  plate: string | null;
  capacity: number;
}

export interface EventDetail extends EventSummary {
  description: string;
  timezone: string;
  visibility: "public" | "private";
  applications_open_at: string | null;
  applications_close_at: string | null;
  applications_closed: boolean;
  applications_open: boolean;
  contact: Record<string, string>;
  rules_md: string;
  membership: { role: Role; bib: string | null; is_available: boolean; vehicle_id: Uuid | null } | null;
  application: { id: Uuid; status: ApplicationStatus; requested_role: Role | null } | null;
  points: EventPoint[];
  zones: EventZone[];
  vehicles: Vehicle[];
  member_count: number;
  invite_code?: string;
  settings?: Record<string, unknown>;
}

export interface Member {
  user_id: Uuid;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  country: string | null;
  role: Role;
  bib: string | null;
  vehicle_id: Uuid | null;
  is_available: boolean;
  joined_at: string;
  phone?: string | null;
  email?: string;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
}

export interface Application {
  id: Uuid;
  status: ApplicationStatus;
  requested_role: Role | null;
  message: string;
  decided_role: Role | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  user: { id: Uuid; first_name: string; last_name: string; email: string; phone: string | null; country: string | null };
}

export interface MyEvents {
  memberships: { role: Role; bib: string | null; event: EventSummary }[];
  applications: { id: Uuid; status: ApplicationStatus; requested_role: Role | null; created_at: string; event: EventSummary }[];
}

export interface Notification {
  id: Uuid;
  event_id: Uuid | null;
  kind: string;
  critical: boolean;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

/** Canlı konum. `t`: fix zamanı (ms), `rx`: sunucuya varış (ms). */
export interface Position {
  u: Uuid;
  t: number;
  rx: number;
  lat: number;
  lon: number;
  acc: number | null;
  alt: number | null;
  spd: number | null;
  hdg: number | null;
  bat: number | null;
}

export interface LiveMember {
  user_id: Uuid;
  first_name: string;
  last_name: string;
  role: Role;
  bib: string | null;
  vehicle_id: Uuid | null;
  is_available: boolean;
  tracking: boolean;
  pilot_state: PilotState | null;
  phone?: string | null;
}

export interface Flight {
  id: Uuid;
  pilot_id: Uuid;
  status: "preparing" | "flying" | "landed" | "completed" | "cancelled";
  takeoff_at: string | null;
  landed_at: string | null;
  landed_lat: number | null;
  landed_lon: number | null;
}

export interface Retrieve {
  id: Uuid;
  pilot_id: Uuid;
  flight_id: Uuid | null;
  status: RetrieveStatus;
  lat: number;
  lon: number;
  note: string;
  retriever_id: Uuid | null;
  vehicle_id: Uuid | null;
  requested_at: string;
  assigned_at: string | null;
  arrived_at: string | null;
  picked_up_at: string | null;
}

export interface SosAlert {
  id: Uuid;
  user_id: Uuid;
  status: "active" | "acknowledged" | "resolved";
  lat: number | null;
  lon: number | null;
  message: string;
  created_at: string;
  acknowledged_by: Uuid | null;
  acknowledged_at: string | null;
}

export interface LiveSnapshot {
  last_seq: number;
  server_time: number;
  members: LiveMember[];
  positions: Position[];
  flights: Flight[];
  retrieves: Retrieve[];
  sos: SosAlert[];
}

/** Kalıcı operasyon olayı (WS ve /log). */
export interface OpEvent {
  t: string;
  seq: number;
  at: number;
  actor: Uuid | null;
  subject: Uuid | null;
  d: Record<string, unknown>;
}

export interface TrackingConfig {
  moving: { interval_s: number; distance_m: number; accuracy: string };
  slow: { interval_s: number; distance_m: number; accuracy: string };
  stationary: { interval_s: number; distance_m: number; accuracy: string };
  moving_speed_mps: number;
  stationary_speed_mps: number;
  stationary_after_s: number;
  low_battery_pct: number;
  low_battery_factor: number;
  upload_interval_s: number;
  upload_batch: number;
  max_batch: number;
  heartbeat_s: number;
}
