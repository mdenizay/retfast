import { useDeferredValue, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarRange, Hourglass, Map as MapIcon, Plus, Search, Settings2, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { eventsApi } from "@/lib/api/endpoints";
import type { EventStatus, RfEvent } from "@/lib/api/types";
import { fmtDate } from "@/lib/format";
import { EmptyState, ErrorState, Loading, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DemoBadge, EventStatusBadge } from "@/features/events/EventBits";
import { cn } from "@/lib/utils";

const STATUSES: ("" | EventStatus)[] = ["", "draft", "published", "active", "completed", "archived"];

export default function AdminEventsPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<"" | EventStatus>("");
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim());
  const events = useQuery({
    queryKey: ["admin", "events", status, dq],
    queryFn: () => eventsApi.list({ status: status || undefined, q: dq || undefined, limit: 200 }),
  });
  const items = events.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.eventsTitle")}
        subtitle={t("admin.eventsLead")}
        actions={<Button asChild><Link to="/app/events/new"><Plus /> {t("admin.newEvent")}</Link></Button>}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("admin.searchEvents")} aria-label={t("admin.searchEvents")} className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("admin.statusFilter")}>
          {STATUSES.map((s) => (
            <button
              key={s || "all"}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={cn(
                "h-9 rounded-sm border px-3 text-footnote font-medium",
                status === s ? "border-fg bg-fg text-background" : "border-border text-fg-secondary hover:bg-accent",
              )}
            >
              {s ? t(`event.status.${s}`) : t("admin.filterAll")}
            </button>
          ))}
        </div>
      </div>

      {events.isLoading ? <Loading /> : events.error ? <ErrorState error={events.error} onRetry={() => void events.refetch()} /> : items.length === 0 ? (
        <EmptyState icon={<CalendarRange className="size-6" />} title={t("admin.noEvents")} body={t("admin.noEventsBody")} />
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border bg-surface" aria-label={t("admin.eventsTitle")}>
          {items.map((e) => <AdminEventRow key={e.id} event={e} />)}
        </ul>
      )}
    </div>
  );
}

function AdminEventRow({ event: e }: { event: RfEvent }) {
  const { t, locale } = useI18n();
  const organizers = e.organizers ?? [];
  const pending = e.counts?.pending_applications ?? 0;
  return (
    <li className="flex flex-col gap-3 border-b border-border px-4 py-4 last:border-0 lg:flex-row lg:items-center sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/app/events/${e.id}`} className="truncate text-headline font-medium text-fg hover:underline">{e.name}</Link>
          <EventStatusBadge status={e.status} />
          {e.is_demo && <DemoBadge />}
          {e.visibility === "restricted" && <Badge variant="muted">{t("event.restricted")}</Badge>}
          {pending > 0 && <Badge variant="warning"><Hourglass aria-hidden />{t("admin.pending", { n: pending })}</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-footnote text-fg-secondary">
          {e.location_name && <span>{e.location_name}</span>}
          <span className="tnum">{fmtDate(e.starts_at, locale)} – {fmtDate(e.ends_at, locale)}</span>
          <span className="tnum text-fg-muted">
            {t("admin.counts", { p: e.counts?.pilots ?? 0, o: e.counts?.observers ?? 0, r: e.counts?.retrievers ?? 0 })}
          </span>
        </div>
        <div className="mt-1.5 text-footnote">
          {organizers.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-fg-secondary">
              <ShieldCheck className="size-3.5" aria-hidden />
              <span className="sr-only">{t("admin.organizers")}: </span>
              {organizers.map((o) => o.full_name).join(", ")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-medium text-warning" data-testid="no-organizer">
              <AlertTriangle className="size-3.5" aria-hidden />
              {t("admin.noOrganizer")}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant={organizers.length === 0 ? "default" : "outline"}>
          <Link to={`/app/events/${e.id}/settings#organizers`}><ShieldCheck /> {t("admin.manageOrganizers")}</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to={`/app/events/${e.id}/settings`}><Settings2 /> {t("admin.eventSettings")}</Link>
        </Button>
        {e.settings?.live_tracking && (
          <Button asChild size="sm" variant="ghost">
            <Link to={`/app/events/${e.id}/live`}><MapIcon /> {t("admin.openLive")}</Link>
          </Button>
        )}
      </div>
    </li>
  );
}
