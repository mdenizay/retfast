import { apiUrl } from "@/lib/config";
import { session } from "@/lib/auth/session";
import type { ApiErrorBody, AuthResponse } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, string>;
  readonly retryAfter: number | null;
  readonly requestId: string | null;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    details?: Record<string, string>;
    retryAfter?: number | null;
    requestId?: string | null;
  }) {
    super(opts.message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details ?? {};
    this.retryAfter = opts.retryAfter ?? null;
    this.requestId = opts.requestId ?? null;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  const d = Date.parse(v);
  return Number.isFinite(d) ? Math.max(0, Math.round((d - Date.now()) / 1000)) : null;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  const fallbackCode =
    res.status === 401 ? "unauthorized" : res.status === 403 ? "forbidden" : res.status === 404 ? "not_found"
    : res.status === 429 ? "rate_limited" : res.status >= 500 ? "internal" : "error";
  return new ApiError({
    status: res.status,
    code: body?.error?.code ?? fallbackCode,
    message: body?.error?.message ?? res.statusText ?? "Request failed",
    details: body?.error?.details,
    retryAfter: parseRetryAfter(res.headers.get("Retry-After")),
    requestId: res.headers.get("X-Request-Id"),
  });
}

/* ---------- refresh (single-flight) ---------- */

let refreshInFlight: Promise<AuthResponse | null> | null = null;

/**
 * POST /auth/refresh using the HttpOnly `rf_refresh` cookie. Concurrent callers share one request
 * (rotation means a second parallel refresh would trip reuse detection and revoke the family).
 * Resolves null when there is no valid session.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(apiUrl("/auth/refresh"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        // 5xx / network trouble: keep current state, but report "no session" to the caller.
        if (res.status === 401 || res.status === 403 || res.status === 400) session.clear();
        return null;
      }
      const data = (await res.json()) as AuthResponse;
      session.setAuth(data);
      return data;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/* ---------- request ---------- */

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  /** Send cookies (auth endpoints). */
  withCredentials?: boolean;
  /** Return the raw Response (downloads). */
  raw?: boolean;
  /** Skip the automatic refresh-and-retry on token_expired. */
  noRetry?: boolean;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(apiUrl(path));
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function doFetch(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = session.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  return fetch(buildUrl(path, opts.query), {
    method: opts.method ?? "GET",
    headers,
    body,
    signal: opts.signal,
    credentials: opts.withCredentials ? "include" : "same-origin",
  });
}

export async function apiRaw(path: string, opts: RequestOptions = {}): Promise<Response> {
  const usedToken = session.token();
  let res = await doFetch(path, opts);

  if (res.status === 401 && usedToken && !opts.noRetry) {
    const err = await toApiError(res.clone());
    if (err.code === "token_expired" || err.code === "unauthorized") {
      const current = session.token();
      if (current && current !== usedToken) {
        // Another request already refreshed while this one was in flight.
        res = await doFetch(path, opts);
      } else {
        const refreshed = await refreshSession();
        if (refreshed) res = await doFetch(path, opts);
        else session.clear();
      }
    }
  }

  if (!res.ok) {
    const err = await toApiError(res);
    if (err.code === "password_change_required") session.markPasswordChangeRequired();
    throw err;
  }
  return res;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await apiRaw(path, opts);
  if (opts.raw) return res as unknown as T;
  if (res.status === 204 || res.status === 202) {
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Test helper. */
export function __resetRefreshForTests() {
  refreshInFlight = null;
}
