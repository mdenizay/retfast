/** Thin typed wrappers over the v1 REST contract (docs/architecture/api-contract.md). */
import { api, apiRaw } from "./client";
import type {
  AdminStats, AdminUser, Application, ApplicationStatus, AuditEntry, AuthResponse, EventReport, EventSettings,
  Flight, LaunchSite, LatLon, LiveSnapshot, Me, Member, MemberRole, NotificationItem, Page, PilotProfile, Position,
  Preferences, PublicPilot, Retrieval, RfEvent, UserSearchItem,
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

export const usersApi = {
  publicPilot: (publicId: string) => api<PublicPilot>(`/pilots/${enc(publicId)}`),
  search: (q: string) => api<{ items: UserSearchItem[] }>("/users/search", { query: { q } }),
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

function asItems<T>(r: { items: T[] } | T[] | null | undefined): T[] {
  return Array.isArray(r) ? r : (r?.items ?? []);
}

export const eventsApi = {
  list: (query: { status?: string; q?: string; mine?: boolean; limit?: number; cursor?: string } = {}) =>
    api<Page<RfEvent>>("/events", { query: { ...query, mine: query.mine ? "true" : undefined } }),
  get: (idOrSlug: string) => api<RfEvent>(`/events/${enc(idOrSlug)}`),
  create: (body: EventInput) => api<RfEvent>("/events", { method: "POST", body }),
  update: (id: string, body: Partial<EventInput>) => api<RfEvent>(`/events/${enc(id)}`, { method: "PATCH", body }),
  archive: (id: string) => api<RfEvent>(`/events/${enc(id)}/archive`, { method: "POST", body: {} }),

  organizers: (id: string) =>
    api<{ items: { user_id: string; full_name: string }[] } | { user_id: string; full_name: string }[]>(`/events/${enc(id)}/organizers`).then(asItems),
  addOrganizer: (id: string, user_id: string) => api<unknown>(`/events/${enc(id)}/organizers`, { method: "POST", body: { user_id } }),
  removeOrganizer: (id: string, userId: string) => api<void>(`/events/${enc(id)}/organizers/${enc(userId)}`, { method: "DELETE" }),

  /** Users apply without a role; the organizer chooses it when approving. */
  apply: (id: string, message?: string) =>
    api<Application>(`/events/${enc(id)}/applications`, { method: "POST", body: { message: message || undefined } }),
  applications: (id: string, status?: ApplicationStatus) =>
    api<{ items: Application[] }>(`/events/${enc(id)}/applications`, { query: { status } }).then(asItems),
  approve: (id: string, appId: string, role: MemberRole, note?: string) =>
    api<unknown>(`/events/${enc(id)}/applications/${enc(appId)}/approve`, { method: "POST", body: { role, note: note || undefined } }),
  reject: (id: string, appId: string, note?: string) =>
    api<unknown>(`/events/${enc(id)}/applications/${enc(appId)}/reject`, { method: "POST", body: { note: note || undefined } }),
  withdraw: (id: string, appId: string) =>
    api<unknown>(`/events/${enc(id)}/applications/${enc(appId)}/withdraw`, { method: "POST", body: {} }),

  members: (id: string, role?: MemberRole) => api<{ items: Member[] }>(`/events/${enc(id)}/members`, { query: { role } }).then(asItems),
  addMember: (id: string, user_id: string, role: MemberRole) =>
    api<Member>(`/events/${enc(id)}/members`, { method: "POST", body: { user_id, role } }),
  updateMember: (id: string, userId: string, role: MemberRole) =>
    api<Member>(`/events/${enc(id)}/members/${enc(userId)}`, { method: "PATCH", body: { role } }),
  removeMember: (id: string, userId: string) => api<void>(`/events/${enc(id)}/members/${enc(userId)}`, { method: "DELETE" }),
  leave: (id: string) => api<unknown>(`/events/${enc(id)}/leave`, { method: "POST", body: {} }),

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

export const retrievalsApi = {
  list: (eventId: string, status?: string, signal?: AbortSignal) =>
    api<{ items: Retrieval[] } | Retrieval[]>(`/events/${enc(eventId)}/retrievals`, { query: { status }, signal }).then(asItems),
  get: (id: string) => api<Retrieval>(`/retrievals/${enc(id)}`),
  accept: (id: string) => api<Retrieval>(`/retrievals/${enc(id)}/accept`, { method: "POST", body: {} }),
  release: (id: string) => api<Retrieval>(`/retrievals/${enc(id)}/release`, { method: "POST", body: {} }),
  assign: (id: string, retriever_user_id: string) =>
    api<Retrieval>(`/retrievals/${enc(id)}/assign`, { method: "POST", body: { retriever_user_id } }),
  pickedUp: (id: string) => api<Retrieval>(`/retrievals/${enc(id)}/picked-up`, { method: "POST", body: {} }),
  delivered: (id: string, note?: string) =>
    api<Retrieval>(`/retrievals/${enc(id)}/delivered`, { method: "POST", body: { note: note || undefined } }),
  cancel: (id: string, reason?: string) =>
    api<Retrieval>(`/retrievals/${enc(id)}/cancel`, { method: "POST", body: { reason: reason || undefined } }),
  addNote: (id: string, body: string) => api<unknown>(`/retrievals/${enc(id)}/notes`, { method: "POST", body: { body } }),
  setDuty: (eventId: string, on_duty: boolean) =>
    api<unknown>(`/events/${enc(eventId)}/retrievers/me/duty`, { method: "PUT", body: { on_duty } }),
  postMyPosition: (eventId: string, body: { lat: number; lon: number; h_acc_m: number; t: string; course_deg?: number | null; speed_ms?: number | null }) =>
    api<unknown>(`/events/${enc(eventId)}/retrievers/me/position`, { method: "POST", body, noRetry: true }),
};

export const flightsApi = {
  list: (query: { event_id?: string; status?: string; pilot_id?: string; limit?: number; cursor?: string } = {}) =>
    api<Page<Flight>>("/flights", { query }),
  get: (idOrPublic: string) => api<Flight>(`/flights/${enc(idOrPublic)}`),
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

export const notificationsApi = {
  list: () => api<{ items: NotificationItem[] }>("/notifications").then(asItems),
  read: (id: string) => api<unknown>(`/notifications/${enc(id)}/read`, { method: "POST", body: {} }),
  readAll: () => api<unknown>("/notifications/read-all", { method: "POST", body: {} }),
};

export const adminApi = {
  stats: () => api<AdminStats>("/admin/stats"),
  users: (q?: string) => api<Page<AdminUser>>("/admin/users", { query: { q } }),
  updateUser: (id: string, body: { is_platform_admin?: boolean; disabled?: boolean }) =>
    api<AdminUser>(`/admin/users/${enc(id)}`, { method: "PATCH", body }),
  resetPassword: (id: string) => api<void>(`/admin/users/${enc(id)}/reset-password`, { method: "POST", body: {} }),
  audit: (query: { actor_id?: string; action?: string; limit?: number } = {}) => api<Page<AuditEntry>>("/admin/audit", { query }),
};
