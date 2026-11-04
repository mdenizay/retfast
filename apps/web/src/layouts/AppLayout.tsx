import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, CalendarRange, LayoutDashboard, LifeBuoy, LogOut, Menu, Plane, ScrollText, Settings, ShieldCheck, Siren, Users, UserSearch,
} from "lucide-react";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { hasRole, isResponder, logout, useSession } from "@/lib/auth";
import type { GlobalRole, Me } from "@/lib/api/types";
import { incidentsApi } from "@/lib/api/endpoints";
import { Logo } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { LangToggle, ThemeToggle } from "./Preferences";

interface NavItem {
  to: string;
  label: MessageKey;
  Icon: typeof Plane;
  roles?: GlobalRole[];
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/app", label: "nav.dashboard", Icon: LayoutDashboard, end: true },
  { to: "/app/events", label: "nav.events", Icon: CalendarRange },
  { to: "/app/flights", label: "nav.flights", Icon: Plane },
  { to: "/app/incidents", label: "nav.incidents", Icon: Siren },
  { to: "/app/rescue", label: "nav.rescue", Icon: LifeBuoy, roles: ["rescue_operator", "platform_admin"] },
  { to: "/app/pilots", label: "nav.pilots", Icon: UserSearch, roles: ["event_organizer", "platform_admin"] },
  { to: "/app/reports", label: "nav.reports", Icon: BarChart3, roles: ["event_organizer", "platform_admin"] },
];
const ADMIN_NAV: NavItem[] = [
  { to: "/app/admin/users", label: "nav.adminUsers", Icon: Users, roles: ["platform_admin"] },
  { to: "/app/admin/audit", label: "nav.adminAudit", Icon: ScrollText, roles: ["platform_admin"] },
];

// eslint-disable-next-line react-refresh/only-export-components
export function visibleNav(user: Me | null, items: NavItem[]) {
  return items.filter((i) => !i.roles || hasRole(user, ...i.roles));
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const { user } = useSession();
  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex h-11 items-center gap-3 rounded-sm px-3 text-body transition-colors",
      isActive ? "bg-accent font-medium text-fg" : "text-fg-secondary hover:bg-accent hover:text-fg",
    );
  const admin = visibleNav(user, ADMIN_NAV);
  return (
    <nav aria-label={t("nav.app")} className="flex flex-col gap-0.5">
      {visibleNav(user, NAV).map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className={link} onClick={onNavigate}>
          <i.Icon className="size-[18px]" aria-hidden /> {t(i.label)}
        </NavLink>
      ))}
      {admin.length > 0 && (
        <>
          <div className="mt-4 mb-1 flex items-center gap-1.5 px-3 text-caption font-medium tracking-wide text-fg-muted uppercase">
            <ShieldCheck className="size-3.5" aria-hidden /> {t("nav.admin")}
          </div>
          {admin.map((i) => (
            <NavLink key={i.to} to={i.to} className={link} onClick={onNavigate}>
              <i.Icon className="size-[18px]" aria-hidden /> {t(i.label)}
            </NavLink>
          ))}
        </>
      )}
      <div className="my-3 h-px bg-border" />
      <NavLink to="/app/settings" className={link} onClick={onNavigate}>
        <Settings className="size-[18px]" aria-hidden /> {t("nav.settings")}
      </NavLink>
    </nav>
  );
}

function UserFooter() {
  const { t } = useI18n();
  const { user } = useSession();
  const navigate = useNavigate();
  return (
    <div className="space-y-3 border-t border-border p-3">
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <LangToggle />
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-footnote font-medium">{user?.full_name}</div>
          <div className="truncate text-caption text-fg-muted">{user?.email}</div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("auth.logout")}
          title={t("auth.logout")}
          onClick={async () => {
            await logout().catch(() => undefined);
            navigate("/login", { replace: true });
          }}
        >
          <LogOut />
        </Button>
      </div>
    </div>
  );
}

/** Responders see a persistent banner while any SOS is open. */
function OpenIncidentBanner() {
  const { t } = useI18n();
  const { user } = useSession();
  const enabled = isResponder(user) || hasRole(user, "event_organizer");
  const q = useQuery({
    queryKey: ["incidents", "open-banner"],
    queryFn: () => incidentsApi.list({ status: "open" }),
    enabled,
    refetchInterval: 15_000,
  });
  const open = (q.data?.items ?? []).filter((i) => i.status === "open");
  if (!enabled || open.length === 0) return null;
  const real = open.filter((i) => !i.is_test).length;
  return (
    <Link
      to="/app/incidents?status=open"
      role="alert"
      className={cn(
        "flex min-h-11 items-center gap-2 px-4 text-footnote font-medium",
        real > 0 ? "bg-emergency text-on-emergency" : "border-b border-warning/50 bg-warning/10 text-warning",
      )}
    >
      <Siren className="size-4" aria-hidden />
      {real > 0 ? t("incident.banner", { n: real }) : t("incident.bannerTest", { n: open.length })}
      <span className="ml-auto underline underline-offset-2">{t("incident.bannerOpen")}</span>
    </Link>
  );
}

export function AppLayout() {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2">
        {t("a11y.skip")}
      </a>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-16 items-center px-4">
          <Link to="/app" aria-label="Retfast"><Logo /></Link>
          <span className="ml-2 rounded-[6px] border border-border px-1.5 text-caption text-fg-muted">OPS</span>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2"><NavList /></div>
        <UserFooter />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-3 lg:hidden">
          <Button variant="ghost" size="icon-sm" aria-label={t("nav.menu")} onClick={() => setMenuOpen(true)}>
            <Menu />
          </Button>
          <Link to="/app" aria-label="Retfast"><Logo /></Link>
        </header>
        <OpenIncidentBanner />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 gap-0 p-0">
          <SheetTitle className="flex h-14 items-center px-4"><Logo /></SheetTitle>
          <div className="flex-1 overflow-y-auto px-2"><NavList onNavigate={() => setMenuOpen(false)} /></div>
          <UserFooter />
        </SheetContent>
      </Sheet>
    </div>
  );
}
