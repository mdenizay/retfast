import { ApiError, createClient } from "@retfast/core";

/** Tarayıcı: aynı origin, cookie ile. */
export const api = createClient({ baseUrl: "/api/v1" });

export function wsBase(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}/api/v1`;
}

export function errorCode(e: unknown): string {
  return e instanceof ApiError ? e.code : "unknown";
}
