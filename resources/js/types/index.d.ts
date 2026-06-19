export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'event_manager' | 'pilot' | 'retriever';
  phone?: string;
  avatar_url?: string;
  is_active: boolean;
}

export interface Event {
  id: string;
  name: string;
  description?: string;
  location: string;
  status: 'draft' | 'active' | 'completed' | 'cancelled';
  start_date: string;
  end_date: string;
  map_center_lat?: number;
  map_center_lng?: number;
  map_zoom?: number;
  max_pilots?: number;
  location_update_interval_seconds: number;
  drop_off_points: DropOffPoint[];
  managers?: User[];
  applications_count?: number;
  pending_count?: number;
  created_at: string;
}

export interface DropOffPoint {
  id: string;
  event_id: string;
  name: string;
  lat: number;
  lng: number;
  is_default: boolean;
}

export interface Flight {
  id: string;
  event_id: string;
  pilot_id: string;
  flight_number: number;
  status: 'flying' | 'landed' | 'sos' | 'completed';
  started_at: string;
  landed_at?: string;
  completed_at?: string;
  sos_triggered_at?: string;
  landing_lat?: number;
  landing_lng?: number;
  pilot?: User;
  event?: Pick<Event, 'id' | 'name'>;
  retrieval_request?: RetrievalRequest;
  location_points_count?: number;
}

export interface RetrievalRequest {
  id: string;
  flight_id: string;
  pilot_id: string;
  retriever_id?: string;
  event_id: string;
  status: 'pending' | 'assigned' | 'en_route' | 'picked_up' | 'delivered' | 'cancelled';
  landing_lat: number;
  landing_lng: number;
  drop_off_point_id?: string;
  assigned_at?: string;
  picked_up_at?: string;
  delivered_at?: string;
  drop_off_point?: DropOffPoint;
  retriever?: User;
}

export interface EventApplication {
  id: string;
  event_id: string;
  user_id: string;
  type: 'pilot' | 'retriever';
  status: 'pending' | 'approved' | 'rejected';
  vehicle_capacity?: number;
  vehicle_description?: string;
  notes?: string;
  user?: User;
  reviewed_at?: string;
}

export interface FlightEvent {
  id: number;
  flight_id: string;
  type: string;
  message: string;
  lat?: number;
  lng?: number;
  actor?: Pick<User, 'id' | 'name'>;
  created_at: string;
}

export interface PageProps {
  auth: { user: User | null };
  flash: { success?: string; error?: string };
  ziggy: { url: string; port?: number; defaults: Record<string, unknown>; routes: Record<string, unknown> };
}
