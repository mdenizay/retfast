import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Lock } from "lucide-react";
import { hasRole, useSession } from "@/lib/auth";
import type { GlobalRole } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n";
import { Loading } from "@/components/common";
import { useOptionalEventContext } from "@/features/events/context";

/** Paths reachable while the server demands a password change. */
const PASSWORD_CHANGE_ALLOWED = ["/change-password", "/privacy"];

/** Root guard: if the account must change its password, nothing else is reachable. */
export function ForcePasswordChange({ children }: { children?: ReactNode }) {
  const { user } = useSession();
  const loc = useLocation();
  if (user?.must_change_password && !PASSWORD_CHANGE_ALLOWED.includes(loc.pathname)) {
    const authPage = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email"].includes(loc.pathname);
    const next = authPage ? (new URLSearchParams(loc.search).get("next") ?? "/app") : loc.pathname + loc.search;
    return <Navigate to={`/change-password?next=${encodeURIComponent(safeNext(next))}`} replace />;
  }
  return <>{children ?? <Outlet />}</>;
}

export function FullScreenLoading() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Loading />
    </div>
  );
}

export function RequireAuth({ children }: { children?: ReactNode }) {
  const { status } = useSession();
  const loc = useLocation();
  if (status === "loading") return <FullScreenLoading />;
  if (status === "anonymous") {
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  return <>{children ?? <Outlet />}</>;
}

/** Hides UI the user can't use; the API remains the security boundary. */
export function RequireRole({ roles, children }: { roles: GlobalRole[]; children?: ReactNode }) {
  const { user } = useSession();
  if (!hasRole(user, ...roles)) return <NoAccess />;
  return <>{children ?? <Outlet />}</>;
}

/**
 * Event-scoped guard (inside /app/events/:id): "manage" = organizer/admin, "operate" = + observers,
 * "retriever" = event retriever (organizers/admins may look too).
 */
export function RequireEventAccess({ need, children }: { need: "manage" | "operate" | "retriever"; children?: ReactNode }) {
  const ctx = useOptionalEventContext();
  if (!ctx) return <NoAccess />;
  const a = ctx.access;
  const ok = need === "manage" ? a.canManage : need === "operate" ? a.canOperate : a.isRetriever || a.canManage;
  if (!ok) return <NoAccess />;
  return <>{children ?? <Outlet />}</>;
}

export function NoAccess() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-24 text-center">
      <Lock className="size-6 text-fg-muted" aria-hidden />
      <h1 className="text-title3 font-semibold">{t("error.noAccessTitle")}</h1>
      <p className="text-footnote text-fg-secondary">{t("error.noAccessBody")}</p>
    </div>
  );
}

/** Logged-in users visiting /login etc. go straight to their destination. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const loc = useLocation();
  if (status === "loading") return <FullScreenLoading />;
  if (status === "authenticated") {
    const next = new URLSearchParams(loc.search).get("next");
    return <Navigate to={safeNext(next)} replace />;
  }
  return <>{children}</>;
}

/** Only same-origin relative paths are accepted as redirect targets. */
// eslint-disable-next-line react-refresh/only-export-components
export function safeNext(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
