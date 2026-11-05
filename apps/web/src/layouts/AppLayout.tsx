import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell, CalendarRange, Car, Gauge, Home, LogOut, Menu, Navigation2, ScrollText, Settings, ShieldCheck, Users,
} from "lucide-react";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { isAdmin, logout, useSession } from "@/lib/auth";
import { eventsApi, notificationsApi } from "@/lib/api/endpoints";
import type { RfEvent } from "@/lib/api/types";
import { fmtDateTime } from "@/lib/format";
import { Logo } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { LangToggle, ThemeToggle } from "./Preferences";

/** My events (cached; shared by nav, home and the events page). */
// eslint-disable-next-line react-refresh/only-export-components
export function useMyEvents() {
  const { user } = useSession();
  return useQuery({
    queryKey: ["app", "events", "mine", user?.id ?? null],
    queryFn: () => eventsApi.list({ mine: true, limit: 100 }),
    staleTime: 30_000,
    enabled: Boolean(user),
  });
}

interface NavItem {
  to: string;
  label: MessageKey;
  Icon: typeof Home;
  end?: boolean;
}

const linkCls = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-body transition-colors",
    isActive ? "bg-surface font-medium text-fg shadow-xs ring-1 ring-border dark:bg-muted" : "text-fg-secondary hover:bg-fg/5 hover:text-fg",
  );

function NavSection({ label, Icon, children }: { label: string; Icon?: typeof Home; children: React.ReactNode }) {
  return (
    <>
      <div className="mt-5 mb-1 flex items-center gap-1.5 px-2.5 text-caption font-medium text-fg-muted">
        {Icon && <Icon className="size-3.5" aria-hidden />} {label}
      </div>
      {children}
    </>
  );
}

function isLiveNow(e: RfEvent) {
  return e.status === "active" && e.settings.live_tracking;
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const { user } = useSession();
  const mine = useMyEvents();
  const events = mine.data?.items ?? [];
  const retrieverEvents = events.filter((e) => e.me?.role === "retriever");
  const opsNow = events.filter((e) => isLiveNow(e) && (e.me?.is_organizer || e.me?.role === "observer"));

  const main: NavItem[] = [
    { to: "/app", label: "nav.home", Icon: Home, end: true },
    { to: "/app/events", label: "nav.myEvents", Icon: CalendarRange },
  ];
  if (retrieverEvents.length > 0) main.push({ to: "/app/retrievals", label: "nav.retrievals", Icon: Car });
  main.push({ to: "/app/flights", label: "nav.flights", Icon: Navigation2 });

  const admin: NavItem[] = isAdmin(user)
    ? [
        { to: "/app/admin", label: "nav.adminSystem", Icon: Gauge, end: true },
        { to: "/app/admin/events", label: "nav.adminEvents", Icon: CalendarRange },
        { to: "/app/admin/users", label: "nav.adminUsers", Icon: Users },
        { to: "/app/admin/audit", label: "nav.adminAudit", Icon: ScrollText },
      ]
    : [];

  return (
    <nav aria-label={t("nav.app")} className="flex flex-col gap-0.5">
      {main.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className={linkCls} onClick={onNavigate}>
          <i.Icon className="size-[18px]" aria-hidden /> {t(i.label)}
        </NavLink>
      ))}
      {opsNow.length > 0 && (
        <NavSection label={t("nav.liveNow")}>
          {opsNow.map((e) => (
            <NavLink key={e.id} to={`/app/events/${e.id}/live`} className={linkCls} onClick={onNavigate}>
              <span className="relative grid size-[18px] place-items-center" aria-hidden>
                <span className="size-2 rounded-full bg-live" />
              </span>
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              <span className="sr-only">{t("fresh.live")}</span>
            </NavLink>
          ))}
        </NavSection>
      )}
      {admin.length > 0 && (
        <NavSection label={t("nav.admin")} Icon={ShieldCheck}>
          {admin.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={linkCls} onClick={onNavigate}>
              <i.Icon className="size-[18px]" aria-hidden /> {t(i.label)}
            </NavLink>
          ))}
        </NavSection>
      )}
      <div className="my-3 h-px bg-border" />
      <NavLink to="/app/settings" className={linkCls} onClick={onNavigate}>
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
    <div className="m-2 space-y-3 rounded-xl border border-border bg-surface p-3 shadow-xs dark:bg-muted/40">
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

/** In-app notifications (GET /notifications), polled once a minute. */
function NotificationsMenu() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications"], queryFn: notificationsApi.list, refetchInterval: 60_000, retry: false });
  const readAll = useMutation({ mutationFn: notificationsApi.readAll, onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const read = useMutation({ mutationFn: notificationsApi.read, onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const items = q.data ?? [];
  const unread = items.filter((n) => !n.read_at).length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={unread ? t("notif.labelUnread", { n: unread }) : t("notif.label")} className="relative">
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-none font-semibold text-white tnum" aria-hidden>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          {t("notif.title")}
          {unread > 0 && (
            <button type="button" className="text-caption font-medium text-fg underline decoration-fg/25 underline-offset-4 transition-colors hover:decoration-fg" onClick={() => readAll.mutate()}>
              {t("notif.readAll")}
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {q.isError ? (
          <div className="px-2 py-3 text-footnote text-fg-muted">{t("notif.unavailable")}</div>
        ) : items.length === 0 ? (
          <div className="px-2 py-3 text-footnote text-fg-muted">{q.isLoading ? t("common.loading") : t("notif.empty")}</div>
        ) : (
          items.slice(0, 12).map((n) => (
            <DropdownMenuItem key={n.id} className="flex flex-col items-start gap-0.5 py-2" onSelect={() => !n.read_at && read.mutate(n.id)}>
              <span className={cn("text-footnote", n.read_at ? "text-fg-secondary" : "font-semibold text-fg")}>
                {!n.read_at && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-brand align-middle" aria-hidden />}
                {n.title}
                {!n.read_at && <span className="sr-only"> ({t("notif.unread")})</span>}
              </span>
              {n.body && <span className="line-clamp-2 text-caption text-fg-muted">{n.body}</span>}
              <span className="telemetry text-caption text-fg-muted">{fmtDateTime(n.created_at, locale)}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-background lg:flex">
        <div className="flex h-16 items-center gap-2 px-4">
          <Link to="/app" aria-label="Retfast"><Logo /></Link>
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-caption font-medium text-fg-muted">OPS</span>
          <div className="ml-auto"><NotificationsMenu /></div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2"><NavList /></div>
        <UserFooter />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col lg:my-2 lg:mr-2 lg:rounded-2xl lg:border lg:border-border lg:bg-surface lg:shadow-xs">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-3 backdrop-blur-md lg:hidden">
          <Button variant="ghost" size="icon-sm" aria-label={t("nav.menu")} onClick={() => setMenuOpen(true)}>
            <Menu />
          </Button>
          <Link to="/app" aria-label="Retfast"><Logo /></Link>
          <div className="ml-auto"><NotificationsMenu /></div>
        </header>
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
