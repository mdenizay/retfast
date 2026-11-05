import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { refreshSession } from "@/lib/api/client";
import { authApi } from "@/lib/api/endpoints";
import type { AuthResponse, GlobalRole, Me } from "@/lib/api/types";
import { session, type SessionState } from "./session";

export { session };

let booted: Promise<unknown> | null = null;

/** Restores the session from the refresh cookie once per page load, then refreshes before expiry. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(session.subscribe, session.get);
  const qc = useQueryClient();

  useEffect(() => {
    if (session.get().status === "loading") {
      booted ??= refreshSession().then((r) => {
        if (!r) session.clear();
      });
    }
  }, []);

  // Proactive refresh 60 s before the access token expires (still single-flight).
  useEffect(() => {
    if (state.status !== "authenticated" || !state.accessExpiresAt) return;
    const ms = Math.max(5_000, state.accessExpiresAt - Date.now() - 60_000);
    const id = setTimeout(() => void refreshSession(), ms);
    return () => clearTimeout(id);
  }, [state.status, state.accessExpiresAt]);

  // Drop cached data when the user changes (logout / other account).
  const userId = state.user?.id ?? null;
  useEffect(() => {
    return () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "public" });
    };
  }, [userId, qc]);

  return <>{children}</>;
}

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.get);
}

export function hasRole(user: Me | null | undefined, ...roles: GlobalRole[]): boolean {
  return Boolean(user && roles.some((r) => user.roles.includes(r)));
}

export const isAdmin = (u: Me | null | undefined) => hasRole(u, "platform_admin");

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await authApi.login(email, password);
  session.setAuth(res);
  return res;
}

export async function logout() {
  try {
    await authApi.logout();
  } finally {
    session.clear();
  }
}

/** Test helper: reset boot single-flight. */
export function __resetBootForTests() {
  booted = null;
}
