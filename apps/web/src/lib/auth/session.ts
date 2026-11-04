/**
 * In-memory session store (access token is never persisted — see api-contract "Web").
 * Exposed as an external store for useSyncExternalStore.
 */
import type { AuthResponse, Me } from "@/lib/api/types";

export type SessionStatus = "loading" | "authenticated" | "anonymous";

export interface SessionState {
  status: SessionStatus;
  user: Me | null;
  accessToken: string | null;
  accessExpiresAt: number | null;
}

const initial: SessionState = { status: "loading", user: null, accessToken: null, accessExpiresAt: null };
let state: SessionState = initial;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const session = {
  get: (): SessionState => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  token: () => state.accessToken,
  setAuth(res: AuthResponse) {
    state = {
      status: "authenticated",
      user: res.user,
      accessToken: res.access_token,
      accessExpiresAt: Date.parse(res.access_expires_at) || null,
    };
    emit();
  },
  setUser(user: Me) {
    if (!state.accessToken) return;
    state = { ...state, user };
    emit();
  },
  /** Server said 403 password_change_required: reflect it locally so guards route to /change-password. */
  markPasswordChangeRequired() {
    if (!state.user || state.user.must_change_password) return;
    state = { ...state, user: { ...state.user, must_change_password: true } };
    emit();
  },
  clear() {
    state = { status: "anonymous", user: null, accessToken: null, accessExpiresAt: null };
    emit();
  },
  /** Test helper. */
  reset() {
    state = initial;
    emit();
  },
};
