import { Link } from "react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarRange, Car, Clock3, Inbox, MapPin, Navigation2, Radar } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminApi, eventsApi, flightsApi, retrievalsApi } from "@/lib/api/endpoints";
import { isAdmin, useSession } from "@/lib/auth";
import type { AdminStats, LiveSnapshot, Retrieval, RfEvent } from "@/lib/api/types";
import { fmtAge, fmtDateTime, fmtDuration } from "@/lib/format";
import { useNow } from "@/hooks/useNow";
import { EmptyState, ErrorState, Heatmap, Loading, PageHeader, PillLink, SectionTitle, StatTile } from "@/components/common";
import { FlightStatusBadge, SimBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { EventRow } from "@/features/events/EventBits";
import { useMyEvents } from "@/layouts/AppLayout";
import { secondsSince } from "@/features/live/derive";
import { cn } from "@/lib/utils";

const MAX_LIVE_POLLS = 6;

interface Attention {
  key: string;
  to: string;
  Icon: typeof Inbox;
  tone: "retrieval" | "primary" | "warning";
  title: string;
  detail: string;
}

export default function HomePage() {
  const { t, lang, locale } = useI18n();
  const { user } = useSession();
  const admin = isAdmin(user);
  const now = useNow(15_000);
  const mine = useMyEvents();
  const events = mine.data?.items ?? [];
  const active = events.filter((e) => e.status === "active");
  const opsEvents = active.filter((e) => (e.me?.is_organizer || e.me?.role === "observer") && e.settings.live_tracking).slice(0, MAX_LIVE_POLLS);
  const retrieverEvents = active.filter((e) => e.me?.role === "retriever").slice(0, MAX_LIVE_POLLS);

  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: adminApi.stats, enabled: admin, refetchInterval: 30_000 });
  const flights = useQuery({ queryKey: ["app", "flights", "home", 100], queryFn: () => flightsApi.list({ limit: 100 }) });
  const lives = useQueries({
    queries: opsEvents.map((e) => ({
      queryKey: ["home", "live", e.id],
      queryFn: () => eventsApi.live(e.id),
      refetchInterval: 30_000,
      retry: false,
    })),
  });
  const openRequests = useQueries({
    queries: retrieverEvents.map((e) => ({
      queryKey: ["home", "retrievals", e.id],
      queryFn: () => retrievalsApi.list(e.id, "requested,accepted,picked_up"),
      refetchInterval: 30_000,
      retry: false,
    })),
  });

  const attention: Attention[] = [];
  for (const e of events) {
    const pending = e.counts?.pending_applications ?? 0;
    if (e.me?.is_organizer && pending > 0) {
      attention.push({
        key: `app-${e.id}`, to: `/app/events/${e.id}/applications`, Icon: Inbox, tone: "warning",
        title: t("home.att.pendingApps", { n: pending }), detail: e.name,
      });
    }
  }
  opsEvents.forEach((e, i) => {
    const snap = lives[i]?.data as LiveSnapshot | undefined;
    if (!snap) return;
    const inAir = snap.pilots.filter((p) => p.status === "recording").length;
    const open = (snap.retrievals ?? []).filter((r) => r.status === "requested");
    if (open.length > 0) {
      const oldest = Math.max(...open.map((r) => secondsSince(r.requested_at, now) ?? 0));
      attention.push({
        key: `ret-${e.id}`, to: `/app/events/${e.id}/live?view=board`, Icon: MapPin, tone: "retrieval",
        title: t("home.att.openRetrievals", { n: open.length }),
        detail: `${e.name} · ${t("home.att.longestWait", { age: fmtAge(oldest, lang) })}`,
      });
    }
    if (inAir > 0) {
      attention.push({
        key: `air-${e.id}`, to: `/app/events/${e.id}/live`, Icon: Radar, tone: "primary",
        title: t("home.att.inAir", { n: inAir }), detail: e.name,
      });
    }
  });
  retrieverEvents.forEach((e, i) => {
    const list = (openRequests[i]?.data as Retrieval[] | undefined) ?? [];
    const requested = list.filter((r) => r.status === "requested").length;
    const minePending = list.filter((r) => r.retriever?.user_id === user?.id && r.status !== "requested").length;
    if (requested > 0 || minePending > 0) {
      attention.push({
        key: `rr-${e.id}`, to: `/app/events/${e.id}/retrievals`, Icon: Car, tone: "retrieval",
        title: minePending > 0 ? t("home.att.myActive", { n: minePending }) : t("home.att.openRequests", { n: requested }),
        detail: e.name,
      });
    }
  });

  const recentFlights = flights.data?.items ?? [];
  const DAYS = 56;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const perDay = new Map<string, number>();
  for (const f of recentFlights) {
    const d = new Date(f.started_at);
    d.setHours(0, 0, 0, 0);
    const k = d.toDateString();
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  const heat = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (DAYS - 1 - i));
    const n = perDay.get(d.toDateString()) ?? 0;
    return { key: d.toISOString(), value: n, title: t("home.heatDay", { date: d.toLocaleDateString(locale, { day: "numeric", month: "short" }), n }) };
  });
  const windowFlights = recentFlights.filter((f) => Date.parse(f.started_at) >= today.getTime() - (DAYS - 1) * 86_400_000);
  const airtime = windowFlights.reduce((sum, f) => sum + (f.stats.duration_s ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("home.greeting", { name: user?.full_name?.split(" ")[0] ?? "" })} />

      {admin && <AdminStrip stats={stats.data} loading={stats.isLoading} error={stats.error} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.15fr]">
        <section className="rounded-3xl bg-surface p-5" aria-labelledby="overview-title">
          <SectionTitle id="overview-title" title={t("home.myEvents")} count={events.length} action={<PillLink to="/app/events">{t("common.seeAll")}</PillLink>} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <StatTile icon={<CalendarRange />} tone="brand" label={t("home.stat.myEvents")} value={mine.isLoading ? "—" : events.length} />
            <StatTile icon={<Radar />} tone="success" label={t("home.stat.activeMine")} value={mine.isLoading ? "—" : active.length} />
            <StatTile icon={<Navigation2 />} label={t("home.stat.flights")} value={flights.isLoading ? "—" : windowFlights.length} />
            <StatTile icon={<Clock3 />} label={t("home.stat.airtime")} value={flights.isLoading ? "—" : (airtime / 3600).toLocaleString(locale, { maximumFractionDigits: 1 })} />
          </div>
        </section>

        <section className="rounded-3xl bg-surface p-5" aria-labelledby="activity-title">
          <SectionTitle id="activity-title" title={t("home.activity")} action={<PillLink to="/app/flights">{t("common.seeAll")}</PillLink>} />
          <p className="mt-0.5 text-footnote text-fg-muted">{t("home.activityHint")}</p>
          <div className="mt-4"><Heatmap days={heat} label={t("home.activity")} /></div>
        </section>
      </div>

      <section aria-labelledby="att-title" className="space-y-3">
        <SectionTitle id="att-title" title={t("home.attention")} count={mine.isLoading ? undefined : attention.length} />
        {mine.isLoading ? (
          <Loading />
        ) : attention.length === 0 ? (
          <p className="rounded-3xl bg-surface px-5 py-5 text-footnote text-fg-secondary">{t("home.att.none")}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {attention.map((a) => (
              <li key={a.key}>
                <Link to={a.to} className="group flex h-full items-center gap-4 rounded-3xl bg-surface p-4 transition-colors hover:bg-surface-elevated">
                  <span
                    className={cn(
                      "grid size-12 shrink-0 place-items-center rounded-full",
                      a.tone === "retrieval" ? "bg-retrieval/15 text-retrieval" : a.tone === "warning" ? "bg-warning/15 text-warning" : "bg-brand/15 text-brand",
                    )}
                    aria-hidden
                  >
                    <a.Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold text-fg tnum">{a.title}</span>
                    <span className="block truncate text-footnote text-fg-muted">{a.detail}</span>
                  </span>
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-fg-muted transition-colors group-hover:text-fg" aria-hidden>
                    <ArrowRight className="size-4" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="space-y-3" aria-labelledby="events-title">
          <SectionTitle id="events-title" title={t("home.myEvents")} />
          {mine.isLoading ? <Loading /> : mine.error ? <ErrorState error={mine.error} /> :
            events.length === 0 ? (
              <EmptyState
                icon={<CalendarRange className="size-6" />}
                title={t("home.noEvents")}
                body={t("home.noEventsBody")}
                action={<Button asChild variant="tinted"><Link to="/events">{t("home.browseEvents")}</Link></Button>}
              />
            ) : (
              <ul className="grid grid-cols-1 gap-3">
                {[...events].sort(byRelevance).slice(0, 6).map((e) => (
                  <EventRow key={e.id} event={e} to={`/app/events/${e.id}`} />
                ))}
              </ul>
            )}
        </section>

        <section className="space-y-3" aria-labelledby="flights-title">
          <SectionTitle id="flights-title" title={t("home.myFlights")} />
          <div className="rounded-3xl bg-surface p-2">
            {flights.isLoading ? <Loading className="px-3" /> : flights.error ? <div className="p-3"><ErrorState error={flights.error} /></div> :
              recentFlights.length === 0 ? (
                <p className="flex items-start gap-2 p-4 text-footnote text-fg-secondary">
                  <Navigation2 className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />{t("home.noFlights")}
                </p>
              ) : (
                <ul>
                  {recentFlights.slice(0, 5).map((f) => (
                    <li key={f.id}>
                      <Link to={`/app/flights/${f.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-muted">
                        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-fg-secondary" aria-hidden><Navigation2 className="size-[18px]" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-medium tnum">{fmtDateTime(f.started_at, locale)}</span>
                          <span className="mt-0.5 flex items-center gap-1.5">{f.is_simulated && <SimBadge />}<FlightStatusBadge status={f.status} /></span>
                        </span>
                        <span className="text-body font-semibold text-fg tnum">{fmtDuration(f.stats.duration_s)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </section>
      </div>
    </div>
  );
}

const STATUS_ORDER: Record<RfEvent["status"], number> = { active: 0, published: 1, draft: 2, completed: 3, archived: 4 };
function byRelevance(a: RfEvent, b: RfEvent) {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || Date.parse(a.starts_at) - Date.parse(b.starts_at);
}

function AdminStrip({ stats, loading, error }: { stats?: AdminStats; loading: boolean; error: unknown }) {
  const { t } = useI18n();
  if (error) return <ErrorState error={error} />;
  const items: [string, number | undefined][] = [
    [t("home.stat.activeEvents"), stats?.active_events],
    [t("home.stat.inAir"), stats?.pilots_in_air],
    [t("home.stat.openRetrievals"), stats?.open_retrievals],
    [t("home.stat.pendingApps"), stats?.pending_applications],
  ];
  const shown = loading ? items : items.filter(([, v]) => typeof v === "number");
  if (!loading && shown.length === 0) return null;
  return (
    <section className="rounded-3xl bg-surface p-5" aria-labelledby="admin-title">
      <SectionTitle id="admin-title" title={t("nav.adminSystem")} action={<PillLink to="/app/admin">{t("home.stat.more")}</PillLink>} />
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {shown.map(([label, v]) => (
          <StatTile key={label} label={label} value={loading ? "—" : v} />
        ))}
      </div>
    </section>
  );
}
