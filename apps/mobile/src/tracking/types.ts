import type {
  Connectivity,
  TrackPoint,
  TrackingRole,
  TrackingSessionStatus,
} from "@retfast/domain";

export type ActiveTrackingState = {
  eventId: string;
  sessionId: string;
  role: TrackingRole;
  displayName: string;
  radioCallsign: string | null;
  pendingOutcome: Exclude<TrackingSessionStatus, "active"> | null;
};

export type QueuedTrackPoint = TrackPoint & { queueId: number };

export type LiveParticipant = {
  sessionId: string;
  userId: string;
  role: TrackingRole;
  displayName: string;
  radioCallsign: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  batteryLevel: number | null;
  isCharging: boolean | null;
  connectivity: Connectivity;
  recordedAt: number;
  receivedAt: number;
  online: boolean;
  lastDisconnectedAt?: number | null;
};
