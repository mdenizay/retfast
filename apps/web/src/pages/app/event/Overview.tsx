import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Car, Check, Eye, Inbox, Minus, Mountain, Navigation2, Radar, ShieldCheck, Smartphone } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { eventsApi, flightsApi } from "@/lib/api/endpoints";
import { fmtCoord, fmtDateTime, fmtDuration } from "@/lib/format";
import { ErrorState, KeyValue, Loading, Panel } from "@/components/common";
import { FlightStatusBadge, SimBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WeatherPanel } from "@/features/events/WeatherPanel";
import { useEventContext } from "@/features/events/context";
import { SETTING_LABELS } from "@/features/events/settings";


export default function EventOverviewPage() {
  const { t, locale } = useI18n();
  const { event: e, access } = useEventContext();
  const sites = useQuery({ queryKey: ["app", "sites", e.id], queryFn: () => eventsApi.launchSites(e.id) });

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-6">
        <RolePanel />
        {e.description && (
          <Panel title={t("event.about")}><p className="whitespace-pre-line text-body text-fg-secondary">{e.description}</p></Panel>
        )}
        <Panel title={t("event.launchSites")} bodyClassName="p-0">
          {sites.isLoading ? <div className="px-4"><Loading /></div> : sites.error ? <div className="p-4"><ErrorState error={sites.error} /></div> :
            (sites.data?.length ?? 0) === 0 ? <p className="p-4 text-footnote text-fg-muted">{t("event.noSites")}</p> : (
              <ul className="divide-y divide-border">
                {sites.data!.map((s) => (
                  <li key={s.id} className="flex items-start gap-3 px-4 py-3">
                    <Mountain className="mt-0.5 size-4 text-fg-muted" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        {!s.is_verified && <Badge variant="warning">{t("site.unverified")}</Badge>}
                      </div>
                      <div className="telemetry text-caption text-fg-muted">
                        {s.position ? fmtCoord(s.position.lat, s.position.lon) : t("site.noCoords")}
                        {s.elevation_m != null ? ` · ${s.elevation_m} m` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </Panel>
      </div>
      <div className="space-y-6">
        <Panel title={t("event.details")}>
          <KeyValue
            items={[
              [t("event.starts"), fmtDateTime(e.starts_at, locale)],
              [t("event.ends"), fmtDateTime(e.ends_at, locale)],
              [t("event.organizers"), e.organizers.length ? e.organizers.map((o) => o.full_name).join(", ") : "—"],
              [t("role.pilot"), String(e.counts?.pilots ?? 0)],
              [t("role.observer"), String(e.counts?.observers ?? 0)],
              [t("role.retriever"), String(e.counts?.retrievers ?? 0)],
              ...(e.center ? ([[t("event.center"), `${fmtCoord(e.center.lat, e.center.lon)}${e.center_is_approximate ? ` (${t("event.approx")})` : ""}`]] as [string, string][]) : []),
            ]}
          />
        </Panel>
        <WeatherPanel event={e} />
        <Panel
          title={t("eventForm.settings")}
          actions={access.canManage ? <Link to={`/app/events/${e.id}/settings`} className="text-footnote text-primary hover:underline">{t("common.edit")}</Link> : undefined}
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border">
            {SETTING_LABELS.map(({ key, label }) => {
              const on = e.settings[key];
              return (
                <li key={key} className="flex items-center gap-3 px-4 py-2.5 text-footnote">
                  {on ? <Check className="size-4 text-success" aria-hidden /> : <Minus className="size-4 text-fg-muted" aria-hidden />}
                  <span className="flex-1 text-fg">{t(label)}</span>
                  <span className={on ? "text-success" : "text-fg-muted"}>{on ? t("common.on") : t("common.off")}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

/** "What you do in this event" — role-specific next steps, real data only. */
function RolePanel() {
  const { t, locale } = useI18n();
  const { event: e, access } = useEventContext();
  const myFlights = useQuery({
    queryKey: ["app", "flights", "event", e.id],
    queryFn: () => flightsApi.list({ event_id: e.id, limit: 5 }),
    enabled: access.role === "pilot",
  });
  const pending = e.counts?.pending_applications ?? 0;
  const blocks: React.ReactNode[] = [];

  if (access.canManage) {
    blocks.push(
      <RoleBlock key="org" Icon={ShieldCheck} title={t("overview.org.title")} body={t("overview.org.body")}>
        <Button asChild variant={pending ? "default" : "outline"} size="sm">
          <Link to={`/app/events/${e.id}/applications`}><Inbox /> {pending ? t("overview.org.pending", { n: pending }) : t("eventTab.applications")}</Link>
        </Button>
        <Button asChild variant="outline" size="sm"><Link to={`/app/events/${e.id}/members`}>{t("eventTab.members")}</Link></Button>
        {e.settings.live_tracking && (
          <Button asChild variant="outline" size="sm"><Link to={`/app/events/${e.id}/live`}><Radar /> {t("event.openOps")}</Link></Button>
        )}
        {!e.settings.applications_open && <p className="w-full text-caption text-fg-muted">{t("overview.org.appsClosed")}</p>}
      </RoleBlock>,
    );
  }
  if (access.role === "observer") {
    blocks.push(
      <RoleBlock key="obs" Icon={Eye} title={t("overview.obs.title")} body={t("overview.obs.body")}>
        {e.settings.live_tracking ? (
          <Button asChild size="sm"><Link to={`/app/events/${e.id}/live`}><Radar /> {t("event.openOps")}</Link></Button>
        ) : <p className="text-caption text-fg-muted">{t("overview.liveOff")}</p>}
      </RoleBlock>,
    );
  }
  if (access.role === "retriever") {
    blocks.push(
      <RoleBlock key="ret" Icon={Car} title={t("overview.ret.title")} body={t("overview.ret.body")}>
        <Button asChild size="sm"><Link to={`/app/events/${e.id}/retrievals`}><Car /> {t("eventTab.myRetrievals")}</Link></Button>
      </RoleBlock>,
    );
  }
  if (access.role === "pilot") {
    blocks.push(
      <RoleBlock key="pil" Icon={Navigation2} title={t("overview.pilot.title")} body={t("overview.pilot.body")}>
        <p className="flex w-full items-start gap-2 text-caption text-fg-secondary">
          <Smartphone className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {e.settings.pilots_see_each_other ? t("overview.pilot.sharingOthers") : t("overview.pilot.sharing")}
        </p>
        {myFlights.data && myFlights.data.items.length > 0 && (
          <ul className="w-full divide-y divide-border rounded-md border border-border">
            {myFlights.data.items.map((f) => (
              <li key={f.id}>
                <Link to={`/app/flights/${f.id}`} className="flex items-center gap-3 px-3 py-2 text-footnote hover:bg-accent">
                  <span className="flex-1 tnum">{fmtDateTime(f.started_at, locale)}</span>
                  {f.is_simulated && <SimBadge />}
                  <FlightStatusBadge status={f.status} />
                  <span className="telemetry w-14 text-right text-fg-muted">{fmtDuration(f.stats.duration_s)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </RoleBlock>,
    );
  }
  if (blocks.length === 0) return null;
  return <div className="space-y-px overflow-hidden rounded-lg border border-border bg-border">{blocks}</div>;
}

function RoleBlock({ Icon, title, body, children }: { Icon: typeof Eye; title: string; body: string; children?: React.ReactNode }) {
  return (
    <section className="bg-surface p-5">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-fg-secondary" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-headline font-semibold">{title}</h2>
          <p className="mt-1 text-footnote text-fg-secondary">{body}</p>
          {children && <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>}
        </div>
      </div>
    </section>
  );
}
