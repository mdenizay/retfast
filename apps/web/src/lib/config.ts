/** Runtime configuration derived from build-time env. */
const rawOrigin = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");

/** Absolute API origin ("" means same origin, e.g. the Vite dev proxy). */
export const API_ORIGIN = rawOrigin;
export const API_PREFIX = "/api/v1";

export function apiUrl(path: string): string {
  const base = API_ORIGIN || (typeof window !== "undefined" ? window.location.origin : "http://localhost");
  return new URL(API_PREFIX + path, base).toString();
}

export function realtimeUrl(): string {
  return apiUrl("/realtime").replace(/^http/, "ws");
}

export const APP_STORE_URL = (import.meta.env.VITE_APP_STORE_URL ?? "").trim() || null;

export const MAP_STYLES = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;

/** Freshness thresholds — mirror packages/design-tokens/tokens.json `freshness` and the API contract. */
export const FRESHNESS = { liveSeconds: 30, lostSeconds: 300 } as const;

export function isAppHost(hostname = typeof window !== "undefined" ? window.location.hostname : ""): boolean {
  return hostname === "app.retfast.com" || hostname.startsWith("app.");
}
