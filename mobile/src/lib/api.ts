import { getAuth } from "@react-native-firebase/auth";
import Constants from "expo-constants";

const configuredUrl = Constants.expoConfig?.extra?.apiUrl;
const apiUrl = (typeof configuredUrl === "string" ? configuredUrl : "http://localhost:3000")
  .replace(/\/$/, "");

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}) {
  const token = await getAuth().currentUser?.getIdToken();
  if (!token) throw new ApiClientError("unauthenticated", "Authentication is required.", 401);
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as {
    data?: T;
    error?: { code?: string; message?: string };
  };
  if (!response.ok || !payload.data) {
    throw new ApiClientError(
      payload.error?.code ?? "request_failed",
      payload.error?.message ?? `API request failed (${response.status}).`,
      response.status,
    );
  }
  return payload.data;
}

export function apiWebSocketUrl() {
  return `${apiUrl.replace(/^http/, "ws")}/v1/ws`;
}

export type ApiTimestamp = {
  toDate: () => Date;
  toMillis: () => number;
};

export function timestamp(value: string | Date | null): ApiTimestamp | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return { toDate: () => date, toMillis: () => date.getTime() };
}
