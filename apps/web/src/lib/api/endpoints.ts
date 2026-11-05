/** Thin typed wrappers over the v1 REST contract. */
import { api, apiRaw } from "./client";
import type {
  AdminStats, AdminUser, Assignment, AssignmentStatus, AuditEntry, AuthResponse, EventReport, EventRole,
  Flight, FlightVisibility, GlobalRole, Incident, IncidentStatus, LaunchSite, LatLon, LiveSnapshot, Me,
  Page, Participant, PilotListItem, PilotProfile, Position, Preferences, PublicPilot, RescueTeamMember, RfEvent,
  EventSettings,
} from "./types";

const enc = encodeURIComponent;

export const authApi = {
  login: (email: string, password: string) =>
    api<AuthResponse>("/auth/login", {
      method: "POST", body: { email, password, client: "web", device_name: "web" }, withCredentials: true, noRetry: true,
    }),
  register: (email: string, password: string, full_name: string) =>
    api<AuthResponse>("/auth/register", { method: "POST", body: { email, password, full_name }, withCredentials: true, noRetry: true }),
  logout: () => api<void>("/auth/logout", { method: "POST", body: {}, withCredentials: true, noRetry: true }),
  changePassword: (current_password: string, new_password: string) =>
    api<AuthResponse>("/auth/password/change", { method: "POST", body: { current_password, new_password }, withCredentials: true }),
  forgot: (email: string) => api<void>("/auth/password/forgot", { method: "POST", body: { email }, noRetry: true }),
  reset: (token: string, new_password: string) =>
    api<void>("/auth/password/reset", { method: "POST", body: { token, new_password }, noRetry: true }),
  verifyEmail: (token: string) => api<void>("/auth/email/verify", { method: "POST", body: { token }, noRetry: true }),
  resendVerification: () => api<void>("/auth/email/verify/resend", { method: "POST", body: {} }),
};

export const meApi = {
  get: () => api<Me>("/me"),
  update: (body: { full_name?: string; preferences?: Partial<Preferences> }) => api<Me>("/me", { method: "PATCH", body }),
  updatePilot: (body: Partial<Omit<PilotProfile, "public_id">>) => api<PilotProfile>("/me/pilot", { method: "PATCH", body }),
  requestDeletion: (reason?: string) =>
    api<{ status: string; requested_at: string }>("/me/deletion-request", { method: "POST", body: { reason } }),
  cancelDeletion: () => api<void>("/me/deletion-request", { method: "DELETE" }),
  exportData: () => apiRaw("/me/export"),
};

export const pilotsApi = {
  publicProfile: (publicId: string) => api<PublicPilot>(`/pilots/${enc(publicId)}`),
  search: (q: string) => api<Page<PilotListItem>>("/pilots", { query: { q, limit: 50 } }),
};

export interface EventInput {
  name: string;
  slug?: string;
  description?: string;
  kind?: string;
  status?: RfEvent["status"];
  visibility?: RfEvent["visibility"];
  location_name?: string;
  center?: LatLon | null;
  center_is_approximate?: boolean;
  starts_at?: string;
  ends_at?: string;
  settings?: Partial<EventSettings>;
}

export const eventsApi = {
  list: (query: { status?: string; q?: string; limit?: number; cursor?: string } = {}) =>
    api<Page<RfEvent>>("/events", { query }),
  get: (idOrSlug: string) => api<RfEvent>(`/events/${enc(idOrSlug)}`),
  create: (body: EventInput) => api<RfEvent>("/events", { method: "POST", body }),
  update: (id: string, body: Partial<EventInput>) => api<RfEvent>(`/events/${enc(id)}`, { method: "PATCH", body }),
  archive: (id: string) => api<RfEvent>(`/events/${enc(id)}/archive`, { method: "POST", body: {} }),
  join: (id: string) => api<unknown>(`/events/${enc(id)}/join`, { method: "POST", body: {} }),
  leave: (id: string) => api<unknown>(`/events/${enc(id)}/leave`, { method: "POST", body: {} }),
  participants: (id: string) => api<{ items: Participant[] }>(`/events/${enc(id)}/participants`),
  addParticipant: (id: string, user_id: string, role: EventRole) =>
    api<Participant>(`/events/${enc(id)}/participants`, { method: "POST", body: { user_id, role } }),
  updateParticipant: (id: string, userId: string, role: EventRole) =>
    api<Participant>(`/events/${enc(id)}/participants/${enc(userId)}`, { method: "PATCH", body: { role } }),
  removeParticipant: (id: string, userId: string) =>
    api<void>(`/events/${enc(id)}/participants/${enc(userId)}`, { method: "DELETE" }),
  launchSites: (id: string) => api<{ items: LaunchSite[] } | LaunchSite[]>(`/events/${enc(id)}/launch-sites`).then(asItems),
  createLaunchSite: (id: string, body: Partial<LaunchSite>) =>
    api<LaunchSite>(`/events/${enc(id)}/launch-sites`, { method: "POST", body }),
  updateLaunchSite: (id: string, siteId: string, body: Partial<LaunchSite>) =>
    api<LaunchSite>(`/events/${enc(id)}/launch-sites/${enc(siteId)}`, { method: "PATCH", body }),
  deleteLaunchSite: (id: string, siteId: string) =>
    api<void>(`/events/${enc(id)}/launch-sites/${enc(siteId)}`, { method: "DELETE" }),
  live: (id: string, signal?: AbortSignal) => api<LiveSnapshot>(`/events/${enc(id)}/live`, { signal }),
  report: (id: string) => api<EventReport>(`/events/${enc(id)}/report`),
};

function asItems<T>(r: { items: T[] } | T[]): T[] {
  return Array.isArray(r) ? r : (r?.items ?? []);
}

export const flightsApi = {
  list: (query: { event_id?: string; status?: string; pilot_id?: string; limit?: number; cursor?: string } = {}) =>
    api<Page<Flight>>("/flights", { query }),
  get: (idOrPublic: string) => api<Flight>(`/flights/${enc(idOrPublic)}`),
  update: (id: string, body: { visibility?: FlightVisibility; event_id?: string | null }) =>
    api<Flight>(`/flights/${enc(id)}`, { method: "PATCH", body }),
  /** Follows next_cursor (bounded) so long flights render fully. */
  async positions(id: string, opts: { simplify?: boolean; maxPages?: number } = {}): Promise<Position[]> {
    const out: Position[] = [];
    let cursor: string | null | undefined;
    for (let i = 0; i < (opts.maxPages ?? 10); i++) {
      const page = await api<Page<Position>>(`/flights/${enc(id)}/positions`, {
        query: { limit: 5000, simplify: opts.simplify ? "true" : undefined, cursor: cursor ?? undefined },
      });
      out.push(...page.items);
      if (!page.next_cursor || page.items.length === 0) break;
      cursor = page.next_cursor;
    }
    return out;
  },
  gpx: (id: string) => apiRaw(`/flights/${enc(id)}/track.gpx`),
};

export const incidentsApi = {
  list: (query: { status?: string; event_id?: string } = {}) => api<Page<Incident>>("/incidents", { query }),
  get: (id: string) => api<Incident>(`/incidents/${enc(id)}`),
  acknowledge: (id: string) => api<Incident>(`/incidents/${enc(id)}/acknowledge`, { method: "POST", body: {} }),
  setStatus: (id: string, status: Extract<IncidentStatus, "responding" | "resolved">, note?: string) =>
    api<Incident>(`/incidents/${enc(id)}/status`, { method: "POST", body: { status, note: note || undefined } }),
  addNote: (id: string, body: string) => api<unknown>(`/incidents/${enc(id)}/notes`, { method: "POST", body: { body } }),
  assign: (id: string, responder_user_id: string) =>
    api<Assignment>(`/incidents/${enc(id)}/assignments`, { method: "POST", body: { responder_user_id } }),
};

export const rescueApi = {
  team: () => api<{ items: RescueTeamMember[] }>("/rescue/team"),
  myAssignments: () => api<{ items: Assignment[] }>("/rescue/assignments"),
  setAssignmentStatus: (id: string, status: AssignmentStatus) =>
    api<Assignment>(`/rescue/assignments/${enc(id)}/status`, { method: "POST", body: { status } }),
  setAvailability: (availability: "available" | "unavailable") =>
    api<unknown>("/rescue/me/status", { method: "PUT", body: { availability } }),
};

export const adminApi = {
  stats: () => api<AdminStats>("/admin/stats"),
  users: (q?: string) => api<Page<AdminUser>>("/admin/users", { query: { q } }),
  updateUser: (id: string, body: { roles?: GlobalRole[]; disabled?: boolean }) =>
    api<AdminUser>(`/admin/users/${enc(id)}`, { method: "PATCH", body }),
  resetPassword: (id: string) => api<void>(`/admin/users/${enc(id)}/reset-password`, { method: "POST", body: {} }),
  audit: (query: { actor_id?: string; action?: string; limit?: number } = {}) => api<Page<AuditEntry>>("/admin/audit", { query }),
};
