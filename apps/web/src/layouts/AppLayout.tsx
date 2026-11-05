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
import { Logo, NameAvatar } from "@/components/common";
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
    "flex h-11 items-center gap-3 rounded-2xl px-3.5 text-body font-medium transition-colors [&>svg]:transition-colors",
    isActive ? "bg-surface text-fg [&>svg]:text-brand" : "text-fg-muted hover:bg-surface/60 hover:text-fg",
  );

function NavSection({ label, Icon, children }: { label: string; Icon?: typeof Home; children: React.ReactNode }) {
  return (
    <>
      <div className="mt-6 mb-1.5 flex items-center gap-1.5 px-3.5 text-caption font-medium text-fg-muted">
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
    <nav aria-label={t("nav.app")} className="flex flex-col gap-1">
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
                <span className="absolute size-2 animate-ping rounded-full bg-live/60 motion-reduce:hidden" />
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
      <div className="my-3" />
      <NavLink to="/app/settings" className={linkCls} onClick={onNavigate}>
        <Settings className="size-[18px]" aria-hidden /> {t("nav.settings")}
      </NavLink>
    </nav>
  );
}

function Avatar({ className }: { className?: string }) {
  const { user } = useSession();
  return <NameAvatar name={user?.full_name} accent className={className} />;
}

function UserFooter() {
  const { t } = useI18n();
  const { user } = useSession();
  const navigate = useNavigate();
  return (
    <div className="m-3 space-y-3 rounded-3xl bg-surface p-3">
      <div className="flex items-center gap-3">
        <Avatar className="size-10" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-footnote font-semibold">{user?.full_name}</div>
          <div className="truncate text-caption text-fg-muted">{user?.email}</div>
        </div>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label={t("auth.logout")}
          title={t("auth.logout")}
          onClick={async () => {
            await logout().catch(() => undefined);
            navigate("/login", { replace: true });
          }}
        >
          <LogOut className="size-4" />
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <ThemeToggle />
        <LangToggle />
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
        <Button variant="secondary" size="icon" aria-label={unread ? t("notif.labelUnread", { n: unread }) : t("notif.label")} className="relative bg-surface hover:bg-surface/70">
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10px] leading-none font-bold text-on-primary tnum ring-2 ring-background" aria-hidden>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          {t("notif.title")}
          {unread > 0 && (
            <button type="button" className="text-caption font-medium font-semibold text-brand underline-offset-4 transition-colors hover:underline" onClick={() => readAll.mutate()}>
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
                {!n.read_at && <span className="mr-1.5 inline-block size-2 rounded-full bg-primary align-middle" aria-hidden />}
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

function TodayTitle() {
  const { t, locale } = useI18n();
  const date = new Date().toLocaleDateString(locale, { day: "numeric", month: "short" });
  return <span className="truncate text-title3 font-semibold tracking-tight text-fg">{t("home.today", { date })}</span>;
}

/** Mobile bottom tab bar: accent on the active item, gray otherwise. */
function TabBar({ onMore }: { onMore: () => void }) {
  const { t } = useI18n();
  const mine = useMyEvents();
  const hasRetrievals = (mine.data?.items ?? []).some((e) => e.me?.role === "retriever");
  const items: NavItem[] = [
    { to: "/app", label: "nav.home", Icon: Home, end: true },
    { to: "/app/events", label: "nav.myEvents", Icon: CalendarRange },
    ...(hasRetrievals ? [{ to: "/app/retrievals", label: "nav.retrievals" as MessageKey, Icon: Car }] : []),
    { to: "/app/flights", label: "nav.flights", Icon: Navigation2 },
  ];
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn("flex min-w-0 flex-1 flex-col items-center gap-1 pt-2.5 pb-1 text-[11px] font-medium transition-colors", isActive ? "text-brand" : "text-fg-muted hover:text-fg");
  return (
    <nav aria-label={t("nav.main")} className="fixed inset-x-0 bottom-0 z-30 border-t border-border/50 bg-background/90 pb-[max(env(safe-area-inset-bottom),0.5rem)] backdrop-blur-xl lg:hidden">
      <div className="mx-auto flex max-w-lg px-2">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={tab}>
            <i.Icon className="size-6" strokeWidth={1.8} aria-hidden />
            <span className="max-w-full truncate">{t(i.label)}</span>
          </NavLink>
        ))}
        <button type="button" onClick={onMore} className="flex min-w-0 flex-1 flex-col items-center gap-1 pt-2.5 pb-1 text-[11px] font-medium text-fg-muted transition-colors hover:text-fg">
          <Menu className="size-6" strokeWidth={1.8} aria-hidden />
          <span>{t("nav.more")}</span>
        </button>
      </div>
    </nav>
  );
}

export function AppLayout() {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex min-h-dvh bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2">
        {t("a11y.skip")}
      </a>
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col lg:flex">
        <div className="flex h-20 items-center px-6">
          <Link to="/app" aria-label="Retfast"><Logo /></Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-1"><NavList /></div>
        <UserFooter />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-xl">
          <div className="mx-auto flex h-20 w-full max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
            <Link to="/app/settings" aria-label={t("nav.settings")} className="lg:hidden"><Avatar /></Link>
            <TodayTitle />
            <div className="ml-auto flex items-center gap-2">
              <NotificationsMenu />
              <Button variant="secondary" size="icon" className="bg-surface hover:bg-surface/70 lg:hidden" aria-label={t("nav.menu")} onClick={() => setMenuOpen(true)}>
                <Menu />
              </Button>
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-2 pb-32 sm:px-6 lg:px-8 lg:pb-12">
          <Outlet />
        </main>
      </div>
      <TabBar onMore={() => setMenuOpen(true)} />
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-80 gap-0 p-0">
          <SheetTitle className="flex h-20 items-center px-6"><Logo /></SheetTitle>
          <div className="flex-1 overflow-y-auto px-3"><NavList onNavigate={() => setMenuOpen(false)} /></div>
          <UserFooter />
        </SheetContent>
      </Sheet>
    </div>
  );
}
