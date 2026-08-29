// Row types mirroring supabase/migrations/0001_schema.sql.

export type EventVisibility = "public" | "unlisted" | "private";
export type EventRole = "pilot" | "retriever" | "observer" | "event_admin";
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type ZoneType = "takeoff" | "landing" | "restricted" | "checkpoint" | "custom";
export type TaskStatus = "active" | "landed" | "completed" | "cancelled";
export type RetrieverAvailability = "offline" | "available" | "busy";
export type RetrievalRequestStatus = "pending" | "accepted" | "declined" | "expired" | "cancelled";
export type AssignmentStatus = "assigned" | "en_route" | "picked_up" | "delivered" | "completed" | "cancelled";
export type EmergencyStatus = "open" | "acknowledged" | "resolved";

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  phone: string | null;
  locale: string;
  is_system_admin: boolean;
}

export interface EventRow {
  id: string;
  name: string;
  description: string;
  starts_at: string;
  ends_at: string;
  visibility: EventVisibility;
  settings: Record<string, unknown>;
  is_archived: boolean;
  created_by: string;
  created_at: string;
}

export interface EventMember {
  id: string;
  event_id: string;
  user_id: string;
  role: EventRole;
  created_at: string;
  profile?: Profile;
}

export interface ParticipationRequest {
  id: string;
  event_id: string;
  user_id: string;
  requested_role: EventRole;
  message: string;
  status: RequestStatus;
  created_at: string;
  profile?: Profile;
}

export interface GeoZone {
  id: string;
  event_id: string;
  name: string;
  zone_type: ZoneType;
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
  sort_order: number;
}

export interface Task {
  id: string;
  event_id: string;
  pilot_id: string;
  title: string;
  status: TaskStatus;
  started_at: string;
  landed_at: string | null;
  finished_at: string | null;
  cancelled_reason: string | null;
  profile?: Profile;
}

export interface LocationPoint {
  id: string;
  event_id: string;
  user_id: string;
  task_id: string | null;
  retriever_session_id: string | null;
  recorded_at: string;
  geom: unknown; // WKB hex over PostgREST; live positions use lat/lng from RPCs
  altitude_m: number | null;
  heading_deg: number | null;
  speed_mps: number | null;
  battery_pct: number | null;
  tracking_state: string;
}

export interface RetrieverProfile {
  event_id: string;
  user_id: string;
  availability: RetrieverAvailability;
  vehicle_capacity: number;
  occupied_seats: number;
  vehicle_description: string;
  last_seen_at: string | null;
  profile?: Profile;
}

export interface RetrievalRequest {
  id: string;
  event_id: string;
  task_id: string;
  pilot_id: string;
  retriever_id: string;
  status: RetrievalRequestStatus;
  expires_at: string;
  created_at: string;
}

export interface RetrievalAssignment {
  id: string;
  event_id: string;
  task_id: string;
  pilot_id: string;
  retriever_id: string;
  assigned_by: string | null;
  status: AssignmentStatus;
  created_at: string;
}

export interface EmergencyEvent {
  id: string;
  event_id: string;
  user_id: string;
  task_id: string | null;
  geom: unknown;
  message: string;
  status: EmergencyStatus;
  created_at: string;
  profile?: Profile;
}

export interface AuditLog {
  id: number;
  actor_id: string | null;
  event_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface TrackPoint {
  recorded_at: string;
  lat: number;
  lng: number;
  altitude_m: number | null;
  speed_mps: number | null;
  heading_deg: number | null;
  battery_pct: number | null;
}

export interface TaskTrack {
  task: Task;
  points: TrackPoint[];
  simplified: GeoJSON.Geometry | null;
  stats: {
    point_count: number;
    distance_m: number;
    max_altitude_m: number | null;
    max_speed_mps: number | null;
    first_at: string | null;
    last_at: string | null;
  };
}

export interface NearbyRetriever {
  user_id: string;
  display_name: string;
  availability: RetrieverAvailability;
  vehicle_capacity: number;
  occupied_seats: number;
  vehicle_description: string;
  distance_m: number;
  last_seen_at: string;
  lat: number;
  lng: number;
}
