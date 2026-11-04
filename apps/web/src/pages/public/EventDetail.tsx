import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Map as MapIcon, MapPin, Mountain, Settings2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { eventsApi } from "@/lib/api/endpoints";
import { hasRole, useSession } from "@/lib/auth";
import { fmtCoord, fmtDateTime } from "@/lib/format";
import { ErrorState, FormError, KeyValue, Loading, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DemoBadge, EventStatusBadge } from "@/features/events/EventBits";

export default function PublicEventDetailPage() {
  const { slug = "" } = useParams();
  const { t, locale } = useI18n();
  const { status, user } = useSession();
  const qc = useQueryClient();
  const event = useQuery({ queryKey: ["public", "event", slug, user?.id ?? null], queryFn: () => eventsApi.get(slug) });
  const sites = useQuery({
    queryKey: ["public", "sites", event.data?.id],
    queryFn: () => eventsApi.launchSites(event.data!.id),
    enabled: Boolean(event.data?.id),
  });
  const join = useMutation({
    mutationFn: () => eventsApi.join(event.data!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["public", "event", slug] }),
  });
  const leave = useMutation({
    mutationFn: () => eventsApi.leave(event.data!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["public", "event", slug] }),
  });

  if (event.isLoading) return <div className="mx-auto max-w-6xl px-4 sm:px-6"><Loading /></div>;
  if (event.error || !event.data) return <div className="mx-auto max-w-3xl px-4 py-16"><ErrorState error={event.error} onRetry={() => void event.refetch()} /></div>;
  const e = event.data;
  const liveAvailable = e.settings.live_tracking && (e.settings.public_live_map || Boolean(e.my_role));
  const isOrganizer = e.my_role === "organizer" || hasRole(user, "platform_admin");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <EventStatusBadge status={e.status} />
        {e.is_demo && <DemoBadge />}
        {e.visibility === "restricted" && <Badge variant="muted">{t("event.restricted")}</Badge>}
      </div>
      <h1 className="mt-3 text-title1 font-semibold tracking-tight">{e.name}</h1>
      {e.location_name && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-body text-fg-secondary"><MapPin className="size-4" aria-hidden />{e.location_name}</p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {liveAvailable && (
          <Button asChild size="lg"><Link to={`/events/${e.slug}/live`}><MapIcon /> {t("event.openLive")}</Link></Button>
        )}
        {status === "authenticated" && !e.my_role && e.settings.registration_open && (
          <Button size="lg" variant="outline" onClick={() => join.mutate()} disabled={join.isPending}>{t("event.join")}</Button>
        )}
        {status === "authenticated" && e.my_role === "participant" && (
          <Button size="lg" variant="ghost" onClick={() => leave.mutate()} disabled={leave.isPending}>{t("event.leave")}</Button>
        )}
        {status === "anonymous" && e.settings.registration_open && (
          <Button asChild size="lg" variant="outline"><Link to={`/login?next=${encodeURIComponent(`/events/${e.slug}`)}`}>{t("event.loginToJoin")}</Link></Button>
        )}
        {isOrganizer && (
          <Button asChild size="lg" variant="ghost"><Link to={`/app/events/${e.id}`}><Settings2 /> {t("event.manage")}</Link></Button>
        )}
      </div>
      <div className="mt-3 max-w-xl"><FormError error={join.error ?? leave.error} /></div>
      {e.my_role && <p className="mt-3 text-footnote text-fg-secondary">{t("event.yourRole", { role: t(`role.event.${e.my_role}`) })}</p>}

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          {e.description ? (
            <Panel title={t("event.about")}><p className="whitespace-pre-line text-body text-fg-secondary">{e.description}</p></Panel>
          ) : null}
          <Panel title={t("event.launchSites")} bodyClassName="p-0">
            {sites.isLoading ? <div className="p-4"><Loading /></div> : sites.error ? <div className="p-4"><ErrorState error={sites.error} /></div> :
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
                        {s.notes && <p className="mt-1 text-footnote text-fg-secondary">{s.notes}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
          </Panel>
        </div>
        <Panel title={t("event.details")}>
          <KeyValue
            items={[
              [t("event.starts"), fmtDateTime(e.starts_at, locale)],
              [t("event.ends"), fmtDateTime(e.ends_at, locale)],
              [t("event.organizer"), e.organizer?.full_name ?? "—"],
              [t("event.participants"), String(e.participant_count)],
              [t("event.registration"), e.settings.registration_open ? t("common.open") : t("common.closed")],
              [t("event.liveMap"), e.settings.live_tracking && e.settings.public_live_map ? t("event.livePublic") : e.settings.live_tracking ? t("event.liveMembers") : t("common.off")],
              ...(e.center ? ([[t("event.center"), `${fmtCoord(e.center.lat, e.center.lon)}${e.center_is_approximate ? ` (${t("event.approx")})` : ""}`]] as [string, string][]) : []),
            ]}
          />
          {e.is_demo && <p className="mt-4 border-t border-border pt-3 text-caption text-fg-muted">{t("event.demoNote")}</p>}
        </Panel>
      </div>
    </div>
  );
}
