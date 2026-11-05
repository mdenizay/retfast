import type { ReactNode } from "react";
import { Link } from "react-router";
import { CalendarRange, ChevronRight, MapPin } from "lucide-react";
import type { EventStatus, RfEvent } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import { myEventRoles } from "@/lib/roles";
import { Badge } from "@/components/ui/badge";
import { RoleBadge } from "@/components/status";

export function EventStatusBadge({ status }: { status: EventStatus }) {
  const { t } = useI18n();
  const variant = status === "active" ? "primary" : status === "published" ? "default" : status === "draft" ? "warning" : "muted";
  return (
    <Badge variant={variant} data-status={status}>
      {status === "active" && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {t(`event.status.${status}`)}
    </Badge>
  );
}

export function DemoBadge() {
  const { t } = useI18n();
  return <Badge variant="sim" title={t("event.demoTitle")}>DEMO</Badge>;
}

export function EventMeta({ event }: { event: RfEvent }) {
  const { t, locale } = useI18n();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-footnote text-fg-secondary">
      {event.location_name && (
        <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{event.location_name}</span>
      )}
      <span className="inline-flex items-center gap-1 tnum">
        <CalendarRange className="size-3.5" aria-hidden />{fmtDate(event.starts_at, locale)} – {fmtDate(event.ends_at, locale)}
      </span>
      <span className="tnum text-fg-muted">
        {t("event.countsLine", { p: event.counts?.pilots ?? 0, o: event.counts?.observers ?? 0, r: event.counts?.retrievers ?? 0 })}
      </span>
    </div>
  );
}

/** List row: name, status, my role badges, meta, optional attention slot on the right. */
export function EventRow({ event, to, attention }: { event: RfEvent; to: string; attention?: ReactNode }) {
  const { t } = useI18n();
  return (
    <li>
      <Link to={to} className="group flex items-center gap-4 border-b border-border px-4 py-4 transition-colors hover:bg-accent sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-headline font-medium text-fg">{event.name}</span>
            <EventStatusBadge status={event.status} />
            {event.is_demo && <DemoBadge />}
            {event.visibility === "restricted" && <Badge variant="muted">{t("event.restricted")}</Badge>}
            {myEventRoles(event).map((r) => <RoleBadge key={r} role={r} />)}
          </div>
          <div className="mt-1"><EventMeta event={event} /></div>
        </div>
        {attention}
        <ChevronRight className="size-5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
      </Link>
    </li>
  );
}
