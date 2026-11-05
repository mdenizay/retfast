import { useMemo } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Car, ExternalLink, Radar } from "lucide-react";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { eventsApi } from "@/lib/api/endpoints";
import { useSession } from "@/lib/auth";
import { eventAccess, myEventRoles } from "@/lib/roles";
import { ErrorState, Loading } from "@/components/common";
import { RoleBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { DateTile, DemoBadge, EventMeta, EventStatusBadge } from "@/features/events/EventBits";
import { EventContext } from "@/features/events/context";
import { cn } from "@/lib/utils";

export default function EventLayout() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const { user } = useSession();
  const q = useQuery({ queryKey: ["app", "event", id], queryFn: () => eventsApi.get(id) });
  const ctx = useMemo(
    () => (q.data ? { event: q.data, access: eventAccess(q.data, user), refetch: () => void q.refetch() } : null),
    [q, user],
  );

  if (q.isLoading) return <Loading />;
  if (!ctx) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { event: e, access } = ctx;
  const pending = e.counts?.pending_applications ?? 0;

  const tabs: { to: string; label: MessageKey; end?: boolean; badge?: number; show: boolean }[] = [
    { to: "", label: "eventTab.overview", end: true, show: true },
    { to: "applications", label: "eventTab.applications", badge: pending, show: access.canManage },
    { to: "members", label: "eventTab.members", show: access.canManage },
    { to: "retrievals", label: "eventTab.myRetrievals", show: access.isRetriever },
    { to: "settings", label: "eventTab.settings", show: access.canManage },
    { to: "report", label: "eventTab.report", show: access.canManage },
  ];
  const liveOk = e.settings.live_tracking && (access.canOperate || access.canSeePilotMap);

  return (
    <EventContext.Provider value={ctx}>
      <div className="space-y-6">
        <header className="space-y-4">
          <div className="flex flex-col gap-5 rounded-3xl bg-surface p-5 sm:p-6 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <DateTile iso={e.starts_at} active={e.status === "active"} />
              <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <EventStatusBadge status={e.status} />
                {e.is_demo && <DemoBadge />}
                {myEventRoles(e).map((r) => <RoleBadge key={r} role={r} />)}
                {access.admin && !access.organizer && <span className="text-caption text-fg-muted">{t("event.adminView")}</span>}
              </div>
              <h1 className="mt-2 text-title2 font-semibold tracking-[-0.02em] text-balance">{e.name}</h1>
              <div className="mt-1.5"><EventMeta event={e} /></div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {liveOk && (
                <Button asChild>
                  <Link to={`/app/events/${e.id}/live`}><Radar /> {access.canOperate ? t("event.openOps") : t("event.openMap")}</Link>
                </Button>
              )}
              {access.isRetriever && (
                <Button asChild variant={liveOk ? "tinted" : "default"}>
                  <Link to={`/app/events/${e.id}/retrievals`}><Car /> {t("eventTab.myRetrievals")}</Link>
                </Button>
              )}
              <Button asChild variant="secondary"><Link to={`/events/${e.slug}`}><ExternalLink /> {t("event.publicPage")}</Link></Button>
            </div>
          </div>
          <nav aria-label={t("eventTab.label")} className="flex gap-1 overflow-x-auto rounded-full bg-surface p-1 [scrollbar-width:none] sm:w-fit">
            {tabs.filter((x) => x.show).map((x) => (
              <NavLink
                key={x.to}
                to={x.to ? `/app/events/${e.id}/${x.to}` : `/app/events/${e.id}`}
                end={x.end}
                className={({ isActive }) =>
                  cn(
                    "inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-footnote font-semibold transition-colors",
                    isActive ? "bg-primary text-on-primary" : "text-fg-secondary hover:bg-muted hover:text-fg",
                  )
                }
              >
                {t(x.label)}
                {x.badge ? (
                  <span className="grid min-w-5 place-items-center rounded-full bg-warning px-1.5 text-caption font-bold text-black tnum">
                    {x.badge}
                    <span className="sr-only"> {t("eventTab.pendingSr")}</span>
                  </span>
                ) : null}
              </NavLink>
            ))}
          </nav>
        </header>
        <Outlet />
      </div>
    </EventContext.Provider>
  );
}
