export type EventRole = "manager" | "pilot" | "retriever" | "observer";

export type EventVisibility = "public" | "unlisted" | "private";

export type EventStatus =
  | "draft"
  | "published"
  | "active"
  | "completed"
  | "cancelled";

export type TrackingRole = Extract<EventRole, "pilot" | "retriever">;

export type TrackingSessionStatus =
  | "active"
  | "completed"
  | "cancelled"
  | "interrupted";

export type Connectivity = "online" | "limited" | "offline" | "unknown";

export type TrackPoint = {
  sequence: number;
  recordedAt: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  speed: number | null;
  heading: number | null;
  batteryLevel: number | null;
  isCharging: boolean | null;
  connectivity: Connectivity;
};
