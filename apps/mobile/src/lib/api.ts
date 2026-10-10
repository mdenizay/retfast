import { ApiError, createClient } from '@retfast/core';
import * as SecureStore from 'expo-secure-store';

/** Simülatörde yerel API için: EXPO_PUBLIC_API_URL=http://localhost:3901/v1 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://retfast.com/api/v1';
export const WS_URL = API_URL.replace(/^http/, 'ws');
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://retfast.com';

const KEY = 'rf_token';
let token: string | null = null;

export async function loadToken(): Promise<string | null> {
  token = await SecureStore.getItemAsync(KEY);
  return token;
}

export async function saveToken(t: string | null) {
  token = t;
  if (t) await SecureStore.setItemAsync(KEY, t);
  else await SecureStore.deleteItemAsync(KEY);
}

export const getToken = () => token;
export const api = createClient({ baseUrl: API_URL, getToken: () => token });

export function errorCode(e: unknown): string {
  return e instanceof ApiError ? e.code : 'unknown';
}
export function isUnauthorized(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}
