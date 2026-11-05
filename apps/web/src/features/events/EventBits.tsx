import type { ReactNode } from "react";
import { Link } from "react-router";
import { CalendarRange, ChevronRight, MapPin } from "lucide-react";
import type { EventStatus, RfEvent } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import { myEventRoles } from "@/lib/roles";
import { Badge } from "@/components/ui/badge";
import { RoleBadge } from "@/components/status";
import { cn } from "@/lib/utils";

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

/** Date tile: big day number with a short month label underneath. */
export function DateTile({ iso, active }: { iso: string; active?: boolean }) {
  const { locale } = useI18n();
  const d = new Date(iso);
  const valid = !Number.isNaN(d.getTime());
  return (
    <span className={cn("flex size-14 shrink-0 flex-col items-center justify-center rounded-2xl", active ? "bg-primary text-on-primary" : "bg-muted text-fg")} aria-hidden>
      <span className="text-title3 leading-none font-semibold tnum">{valid ? d.getDate() : "–"}</span>
      <span className={cn("mt-1 text-[11px] leading-none font-medium uppercase", active ? "opacity-80" : "text-fg-muted")}>
        {valid ? d.toLocaleDateString(locale, { month: "short" }).replace(".", "") : ""}
      </span>
    </span>
  );
}

/** List card: date tile, name, status, my role badges, meta, optional attention slot on the right. */
export function EventRow({ event, to, attention }: { event: RfEvent; to: string; attention?: ReactNode }) {
  const { t } = useI18n();
  return (
    <li>
      <Link to={to} className="group flex items-center gap-4 rounded-3xl bg-surface p-4 transition-colors hover:bg-surface-elevated sm:p-5">
        <DateTile iso={event.starts_at} active={event.status === "active"} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-headline font-semibold text-fg">{event.name}</span>
            <EventStatusBadge status={event.status} />
            {event.is_demo && <DemoBadge />}
            {event.visibility === "restricted" && <Badge variant="muted">{t("event.restricted")}</Badge>}
            {myEventRoles(event).map((r) => <RoleBadge key={r} role={r} />)}
          </div>
          <div className="mt-1.5"><EventMeta event={event} /></div>
        </div>
        {attention}
        <span className="hidden size-10 shrink-0 place-items-center rounded-full bg-muted text-fg-muted transition-colors group-hover:text-fg sm:grid" aria-hidden>
          <ChevronRight className="size-5" />
        </span>
      </Link>
    </li>
  );
}
