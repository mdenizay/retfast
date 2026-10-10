export type Authorization = 'notDetermined' | 'restricted' | 'denied' | 'whenInUse' | 'always';

export type TrackingMode = 'moving' | 'slow' | 'stationary';

export type TrackingStatus = {
  tracking: boolean;
  /** Takibin ait olduğu etkinlik (açık oturum varsa). */
  eventId?: string;
  /** Yüklenmeyi bekleyen nokta sayısı. */
  pending: number;
  authorization: Authorization;
  mode: TrackingMode;
  batteryLow: boolean;
  battery?: number;
  /** `hdg`: baktığı yön (derece); hareket ederken GPS rotası, dururken pusula. */
  lastFix?: { lat: number; lon: number; acc: number; t: number; hdg?: number };
  lastSyncAt?: number;
  lastError?: string;
};

export type SessionEvent = { kind: 'closed' | 'unauthorized' };

export type StartOptions = {
  api_base: string;
  token: string;
  event_id: string;
  session_id: string;
  role: 'pilot' | 'retriever';
  /** `POST /events/{id}/tracking/start` yanıtındaki `config`. */
  config: object;
};

export type RetfastTrackingModuleEvents = {
  onStatus: (status: TrackingStatus) => void;
  onSessionEvent: (e: SessionEvent) => void;
};
