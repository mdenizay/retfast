import type {
  Announcement, Application, EventReport, EventDetail, EventSummary, EventPoint, LiveSnapshot, Member, MyEvents, Notification, OpEvent, PointKind,
  Role, TrackingConfig, User, Uuid, Vehicle, ZoneKind,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface ClientOptions {
  /** ör. web: "/api/v1", mobil: "https://retfast.com/api/v1" */
  baseUrl: string;
  /** Mobil: Bearer belirteci. Web cookie kullanır, gerekmez. */
  getToken?: () => string | null | undefined;
  fetch?: typeof fetch;
}

type Q = Record<string, string | number | undefined | null>;

export function createClient(opts: ClientOptions) {
  const doFetch = opts.fetch ?? fetch;

  async function request<T>(method: string, path: string, body?: unknown, query?: Q): Promise<T> {
    let url = opts.baseUrl + path;
    if (query) {
      const qs = Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
      if (qs) url += `?${qs}`;
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    const token = opts.getToken?.();
    if (token) headers.authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await doFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "include" });
    } catch {
      throw new ApiError(0, "NETWORK", "network error");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiError(res.status, err?.code ?? "HTTP_" + res.status, err?.message ?? res.statusText);
    }
    return data as T;
  }

  const get = <T>(p: string, q?: Q) => request<T>("GET", p, undefined, q);
  const post = <T>(p: string, b?: unknown) => request<T>("POST", p, b);
  const put = <T>(p: string, b?: unknown) => request<T>("PUT", p, b);
  const patch = <T>(p: string, b?: unknown) => request<T>("PATCH", p, b);
  const del = <T>(p: string) => request<T>("DELETE", p);
  type Ok = { ok: true };
  type Session = { user: User; token: string };

  return {
    request,
    auth: {
      register: (b: { email: string; password: string; first_name: string; last_name: string; locale?: string; platform?: string; device_name?: string }) =>
        post<Session>("/auth/register", b),
      login: (b: { email: string; password: string; platform?: string; device_name?: string }) => post<Session>("/auth/login", b),
      logout: () => post<Ok>("/auth/logout"),
    },
    me: {
      get: () => get<User>("/me"),
      update: (b: Partial<Pick<User, "first_name" | "last_name" | "phone" | "country" | "locale" | "emergency_contact_name" | "emergency_contact_phone">>) =>
        patch<User>("/me", b),
      consentLocation: () => post<User>("/me/consent/location"),
      changePassword: (b: { current_password: string; new_password: string }) => post<Ok>("/me/password", b),
      events: () => get<MyEvents>("/me/events"),
      notifications: () => get<{ data: Notification[] }>("/me/notifications"),
      readNotifications: () => post<Ok>("/me/notifications/read"),
    },
    events: {
      list: (scope?: "all" | "current" | "upcoming" | "past") => get<{ data: EventSummary[] }>("/events", { scope }),
      get: (id: Uuid) => get<EventDetail>(`/events/${id}`),
      create: (b: Record<string, unknown>) => post<EventDetail>("/events", b),
      update: (id: Uuid, b: Record<string, unknown>) => patch<EventDetail>(`/events/${id}`, b),
      addPoint: (id: Uuid, b: { kind: PointKind; name: string; lat: number; lon: number; altitude_m?: number | null; description?: string; instructions?: string }) =>
        post<{ id: Uuid }>(`/events/${id}/points`, b),
      deletePoint: (id: Uuid, pointId: Uuid) => del<Ok>(`/events/${id}/points/${pointId}`),
      addZone: (id: Uuid, b: { kind: ZoneKind; name: string; geojson: unknown }) => post<{ id: Uuid }>(`/events/${id}/zones`, b),
      deleteZone: (id: Uuid, zoneId: Uuid) => del<Ok>(`/events/${id}/zones/${zoneId}`),
      addVehicle: (id: Uuid, b: Omit<Vehicle, "id">) => post<{ id: Uuid }>(`/events/${id}/vehicles`, b),
      deleteVehicle: (id: Uuid, vehicleId: Uuid) => del<Ok>(`/events/${id}/vehicles/${vehicleId}`),
      members: (id: Uuid) => get<{ data: Member[] }>(`/events/${id}/members`),
      setMember: (id: Uuid, userId: Uuid, b: { role: Role; bib?: string | null; vehicle_id?: Uuid | null }) => put<Ok>(`/events/${id}/members/${userId}`, b),
      removeMember: (id: Uuid, userId: Uuid) => del<Ok>(`/events/${id}/members/${userId}`),
      leave: (id: Uuid) => post<Ok>(`/events/${id}/leave`),
      apply: (id: Uuid, b: { requested_role?: Role | null; message?: string; invite_code?: string }) =>
        post<{ id: Uuid; status: string }>(`/events/${id}/applications`, b),
      applications: (id: Uuid, status?: string) => get<{ data: Application[] }>(`/events/${id}/applications`, { status }),
      announcements: (id: Uuid) => get<{ data: Announcement[] }>(`/events/${id}/announcements`),
      postAnnouncement: (id: Uuid, b: { title: string; body?: string }) => post<{ id: Uuid }>(`/events/${id}/announcements`, b),
      deleteAnnouncement: (announcementId: Uuid) => del<Ok>(`/announcements/${announcementId}`),
      invite: (id: Uuid, b: { emails: string[]; message?: string }) => post<{ sent: number; skipped: string[] }>(`/events/${id}/invites`, b),
      report: (id: Uuid) => get<EventReport>(`/events/${id}/report`),
      exportPath: (id: Uuid, userId: Uuid, format: "gpx" | "igc") => `/events/${id}/tracks/${userId}/export?format=${format}`,
      live: (id: Uuid) => get<LiveSnapshot>(`/events/${id}/live`),
      log: (id: Uuid, after = 0) => get<{ data: OpEvent[] }>(`/events/${id}/log`, { after }),
      track: (id: Uuid, userId: Uuid, range?: { from?: string; to?: string }) =>
        get<{ columns: string[]; points: [number, number, number, number | null, number | null][] }>(`/events/${id}/tracks/${userId}`, range),
    },
    applications: {
      decide: (id: Uuid, b: { decision: "accept" | "reject"; role?: Role; note?: string }) => post<{ id: Uuid; status: string }>(`/applications/${id}/decide`, b),
      cancel: (id: Uuid) => post<{ id: Uuid; status: string }>(`/applications/${id}/cancel`),
    },
    tracking: {
      start: (id: Uuid, b?: { platform?: string; app_version?: string }) => post<{ session_id: Uuid; config: TrackingConfig }>(`/events/${id}/tracking/start`, b ?? {}),
      stop: (id: Uuid) => post<Ok>(`/events/${id}/tracking/stop`),
    },
    ops: {
      takeoff: (id: Uuid, pilot_id?: Uuid) => post<{ flight_id: Uuid }>(`/events/${id}/flights/takeoff`, { pilot_id }),
      land: (id: Uuid, b: { pilot_id?: Uuid; lat?: number; lon?: number }) => post<{ flight_id: Uuid }>(`/events/${id}/flights/land`, b),
      completeFlight: (id: Uuid, pilot_id?: Uuid) => post<{ flight_id: Uuid }>(`/events/${id}/flights/complete`, { pilot_id }),
      requestRetrieve: (id: Uuid, b: { pilot_id?: Uuid; lat: number; lon: number; note?: string }) => post<{ id: Uuid }>(`/events/${id}/retrieves`, b),
      retrieve: (retrieveId: Uuid, action: "accept" | "assign" | "release" | "arrived" | "picked-up" | "complete" | "cancel", b?: { retriever_id?: Uuid; reason?: string }) =>
        post<{ id: Uuid; status: string; retriever_id: Uuid | null }>(`/retrieves/${retrieveId}/${action}`, b ?? {}),
      availability: (id: Uuid, b: { available: boolean; vehicle_id?: Uuid | null }) => put<{ available: boolean }>(`/events/${id}/availability`, b),
      sos: (id: Uuid, b: { lat?: number; lon?: number; message?: string }) => post<{ id: Uuid }>(`/events/${id}/sos`, b),
      sosAction: (sosId: Uuid, action: "ack" | "resolve", note?: string) => post<{ id: Uuid; status: string }>(`/sos/${sosId}/${action}`, { note }),
    },
    admin: {
      users: (q?: string) => get<{ data: (Pick<User, "id" | "email" | "first_name" | "last_name" | "phone" | "country" | "is_system_admin"> & { created_at: string })[] }>("/admin/users", { q }),
      events: () => get<{ data: (EventSummary & { visibility: string; members: number; pending_applications: number })[] }>("/admin/events"),
      stats: () => get<Record<string, unknown>>("/admin/stats"),
    },
  };
}

export type Client = ReturnType<typeof createClient>;
export type { EventPoint };
