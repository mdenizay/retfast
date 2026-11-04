import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, Map as MapIcon, Plane, Plus, Siren } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminApi, eventsApi, flightsApi, incidentsApi } from "@/lib/api/endpoints";
import { canCreateEvents, hasRole, isResponder, useSession } from "@/lib/auth";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { EmptyState, ErrorState, Loading, PageHeader, Panel } from "@/components/common";
import { FlightStatusBadge, IncidentStatusBadge, SimBadge, TestBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { EventStatusBadge } from "@/features/events/EventBits";
import type { AdminStats } from "@/lib/api/types";

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { user } = useSession();
  const admin = hasRole(user, "platform_admin");
  const responder = isResponder(user) || hasRole(user, "event_organizer");

  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: adminApi.stats, enabled: admin, refetchInterval: 30_000 });
  const events = useQuery({ queryKey: ["app", "events", "dash"], queryFn: () => eventsApi.list({ status: "active,published", limit: 10 }) });
  const flights = useQuery({ queryKey: ["app", "flights", "dash"], queryFn: () => flightsApi.list({ limit: 8 }) });
  const incidents = useQuery({
    queryKey: ["incidents", "dash"],
    queryFn: () => incidentsApi.list({ status: "open,acknowledged,responding" }),
    enabled: responder,
    refetchInterval: 15_000,
  });

  const activeEvents = (events.data?.items ?? []).filter((e) => e.status === "active");
  const recording = (flights.data?.items ?? []).filter((f) => f.status === "recording");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={t("dash.eyebrow")}
        title={t("dash.greeting", { name: user?.full_name?.split(" ")[0] ?? "" })}
        actions={canCreateEvents(user) && <Button asChild><Link to="/app/events/new"><Plus /> {t("events.new")}</Link></Button>}
      />

      {admin ? (
        stats.error ? <ErrorState error={stats.error} /> : <AdminCounters stats={stats.data} loading={stats.isLoading} />
      ) : (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
          <Counter label={t("dash.activeEvents")} value={events.isLoading ? null : activeEvents.length} />
          <Counter label={t("dash.myRecording")} value={flights.isLoading ? null : recording.length} />
          <Counter label={t("dash.myFlights")} value={flights.isLoading ? null : (flights.data?.items.length ?? 0)} hint={t("dash.recentHint")} />
          {responder && <Counter label={t("dash.openIncidents")} value={incidents.isLoading ? null : (incidents.data?.items.length ?? 0)} emergency />}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {responder && (
          <Panel title={t("dash.incidents")} actions={<Link to="/app/incidents" className="text-footnote text-primary hover:underline">{t("common.seeAll")}</Link>} bodyClassName="p-0">
            {incidents.isLoading ? <Loading className="px-4" /> : incidents.error ? <div className="p-4"><ErrorState error={incidents.error} /></div> :
              (incidents.data?.items.length ?? 0) === 0 ? <p className="p-4 text-footnote text-fg-muted">{t("dash.noIncidents")}</p> : (
                <ul className="divide-y divide-border">
                  {incidents.data!.items.slice(0, 6).map((i) => (
                    <li key={i.id}>
                      <Link to={`/app/incidents/${i.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
                        <Siren className="size-4 text-emergency-text" aria-hidden />
                        <span className="min-w-0 flex-1 truncate font-medium">{i.pilot.full_name}</span>
                        {i.is_test && <TestBadge />}
                        <IncidentStatusBadge status={i.status} isTest={i.is_test} />
                        <span className="telemetry text-caption text-fg-muted">{fmtDateTime(i.received_at, locale)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
          </Panel>
        )}

        <Panel title={t("dash.events")} actions={<Link to="/app/events" className="text-footnote text-primary hover:underline">{t("common.seeAll")}</Link>} bodyClassName="p-0">
          {events.isLoading ? <Loading className="px-4" /> : events.error ? <div className="p-4"><ErrorState error={events.error} /></div> :
            (events.data?.items.length ?? 0) === 0 ? <div className="p-4"><EmptyState icon={<CalendarRange className="size-6" />} title={t("events.emptyTitle")} body={t("events.emptyApp")} /></div> : (
              <ul className="divide-y divide-border">
                {events.data!.items.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <Link to={`/app/events/${e.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{e.name}</Link>
                    <EventStatusBadge status={e.status} />
                    {e.settings.live_tracking && (
                      <Button asChild size="sm" variant="outline"><Link to={`/app/events/${e.id}/live`}><MapIcon /> {t("event.live")}</Link></Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
        </Panel>

        <Panel title={t("dash.flights")} actions={<Link to="/app/flights" className="text-footnote text-primary hover:underline">{t("common.seeAll")}</Link>} bodyClassName="p-0">
          {flights.isLoading ? <Loading className="px-4" /> : flights.error ? <div className="p-4"><ErrorState error={flights.error} /></div> :
            (flights.data?.items.length ?? 0) === 0 ? <div className="p-4"><EmptyState icon={<Plane className="size-6" />} title={t("flights.emptyTitle")} body={t("flights.emptyBody")} /></div> : (
              <ul className="divide-y divide-border">
                {flights.data!.items.map((f) => (
                  <li key={f.id}>
                    <Link to={`/app/flights/${f.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
                      <span className="min-w-0 flex-1 truncate">{fmtDateTime(f.started_at, locale)}</span>
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

function Counter({ label, value, hint, emergency }: { label: string; value: number | null | undefined; hint?: string; emergency?: boolean }) {
  return (
    <div className="bg-surface p-5">
      <div className="text-caption text-fg-muted">{label}</div>
      <div className={`telemetry mt-1 text-title1 ${emergency && value ? "text-emergency-text" : "text-fg"}`}>{value ?? "—"}</div>
      {hint && <div className="text-caption text-fg-muted">{hint}</div>}
    </div>
  );
}

function AdminCounters({ stats, loading }: { stats?: AdminStats; loading: boolean }) {
  const { t } = useI18n();
  const v = (n: number | undefined) => (loading ? null : (n ?? null));
  const sys = stats?.system_status;
  const checks = sys?.checks ?? {};
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-5">
        <Counter label={t("dash.activeEvents")} value={v(stats?.active_events)} />
        <Counter label={t("dash.trackingPilots")} value={v(stats?.tracking_pilots)} />
        <Counter label={t("dash.staleSessions")} value={v(stats?.stale_sessions)} />
        <Counter label={t("dash.openIncidents")} value={v(stats?.open_incidents)} emergency />
        <Counter label={t("dash.recentFlights")} value={v(stats?.recent_flights)} />
      </div>
      {sys && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-footnote text-fg-secondary">
          <span className="text-fg-muted">{t("dash.system")}:</span>
          {Object.entries(checks).map(([k, s]) => (
            <span key={k} className="telemetry">
              {k} <span className={s === "ok" ? "text-success" : "text-error"}>{s === "ok" ? "✓ ok" : `✕ ${s}`}</span>
            </span>
          ))}
          {typeof sys.outbox_depth === "number" && <span className="telemetry">{t("dash.outbox")} {sys.outbox_depth}</span>}
          {typeof sys.email_pending === "number" && <span className="telemetry">{t("dash.emailPending")} {sys.email_pending}</span>}
          {typeof sys.email_failed_24h === "number" && (
            <span className={`telemetry ${sys.email_failed_24h > 0 ? "text-warning" : ""}`}>{t("dash.emailFailed")} {sys.email_failed_24h}</span>
          )}
        </div>
      )}
    </div>
  );
}
