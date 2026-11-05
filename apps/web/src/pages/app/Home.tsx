import { Link } from "react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarRange, Car, Inbox, MapPin, Navigation2, Radar } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminApi, eventsApi, flightsApi, retrievalsApi } from "@/lib/api/endpoints";
import { isAdmin, useSession } from "@/lib/auth";
import type { AdminStats, LiveSnapshot, Retrieval, RfEvent } from "@/lib/api/types";
import { fmtAge, fmtDateTime, fmtDuration } from "@/lib/format";
import { useNow } from "@/hooks/useNow";
import { EmptyState, ErrorState, Loading, PageHeader, Panel } from "@/components/common";
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
  const flights = useQuery({ queryKey: ["app", "flights", "home"], queryFn: () => flightsApi.list({ limit: 5 }) });
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

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t("home.eyebrow")} title={t("home.greeting", { name: user?.full_name?.split(" ")[0] ?? "" })} />

      {admin && <AdminStrip stats={stats.data} loading={stats.isLoading} error={stats.error} />}

      <section aria-labelledby="att-title">
        <h2 id="att-title" className="mb-3 text-footnote font-semibold tracking-wide text-fg-secondary uppercase">{t("home.attention")}</h2>
        {mine.isLoading ? (
          <Loading />
        ) : attention.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-5 text-footnote text-fg-secondary">{t("home.att.none")}</p>
        ) : (
          <ul className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
            {attention.map((a) => (
              <li key={a.key} className="bg-surface">
                <Link to={a.to} className="group flex h-full items-center gap-3 px-4 py-4 hover:bg-accent">
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-md border",
                      a.tone === "retrieval" ? "border-retrieval/40 text-retrieval" : a.tone === "warning" ? "border-warning/40 text-warning" : "border-primary/40 text-primary",
                    )}
                    aria-hidden
                  >
                    <a.Icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium text-fg tnum">{a.title}</span>
                    <span className="block truncate text-footnote text-fg-secondary">{a.detail}</span>
                  </span>
                  <ArrowRight className="size-4 text-fg-muted transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel
          title={t("home.myEvents")}
          actions={<Link to="/app/events" className="text-footnote text-primary hover:underline">{t("common.seeAll")}</Link>}
          bodyClassName="p-0"
        >
          {mine.isLoading ? <Loading className="px-4" /> : mine.error ? <div className="p-4"><ErrorState error={mine.error} /></div> :
            events.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={<CalendarRange className="size-6" />}
                  title={t("home.noEvents")}
                  body={t("home.noEventsBody")}
                  action={<Button asChild variant="outline"><Link to="/events">{t("home.browseEvents")}</Link></Button>}
                />
              </div>
            ) : (
              <ul>
                {[...events].sort(byRelevance).slice(0, 8).map((e) => (
                  <EventRow key={e.id} event={e} to={`/app/events/${e.id}`} />
                ))}
              </ul>
            )}
        </Panel>

        <Panel title={t("home.myFlights")} actions={<Link to="/app/flights" className="text-footnote text-primary hover:underline">{t("common.seeAll")}</Link>} bodyClassName="p-0">
          {flights.isLoading ? <Loading className="px-4" /> : flights.error ? <div className="p-4"><ErrorState error={flights.error} /></div> :
            (flights.data?.items.length ?? 0) === 0 ? (
              <p className="flex items-start gap-2 p-4 text-footnote text-fg-secondary">
                <Navigation2 className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />{t("home.noFlights")}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {flights.data!.items.map((f) => (
                  <li key={f.id}>
                    <Link to={`/app/flights/${f.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
                      <span className="min-w-0 flex-1 truncate tnum">{fmtDateTime(f.started_at, locale)}</span>
                      {f.is_simulated && <SimBadge />}
                      <FlightStatusBadge status={f.status} />
                      <span className="telemetry w-16 text-right text-caption text-fg-muted">{fmtDuration(f.stats.duration_s)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
        </Panel>
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
    <div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
        {shown.map(([label, v]) => (
          <div key={label} className="bg-surface p-5">
            <div className="text-caption text-fg-muted">{label}</div>
            <div className="telemetry mt-1 text-title1 text-fg">{loading ? "—" : v}</div>
          </div>
        ))}
      </div>
      <Link to="/app/admin" className="mt-2 inline-block text-footnote text-primary hover:underline">{t("home.stat.more")}</Link>
    </div>
  );
}
