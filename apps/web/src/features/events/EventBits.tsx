import { Link } from "react-router";
import { CalendarRange, ChevronRight, MapPin, Users } from "lucide-react";
import type { EventStatus, RfEvent } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export function EventStatusBadge({ status }: { status: EventStatus }) {
  const { t } = useI18n();
  const variant = status === "active" ? "primary" : status === "published" ? "default" : status === "draft" ? "warning" : "muted";
  return <Badge variant={variant} data-status={status}>{status === "active" && <span className="size-1.5 rounded-full bg-current" aria-hidden />}{t(`event.status.${status}`)}</Badge>;
}

export function DemoBadge() {
  const { t } = useI18n();
  return <Badge variant="sim" title={t("event.demoTitle")}>DEMO</Badge>;
}

export function EventRow({ event, to }: { event: RfEvent; to: string }) {
  const { t, locale } = useI18n();
  return (
    <li>
      <Link to={to} className="group flex items-center gap-4 border-b border-border px-4 py-4 transition-colors hover:bg-accent sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-headline font-medium text-fg">{event.name}</span>
            <EventStatusBadge status={event.status} />
            {event.is_demo && <DemoBadge />}
            {event.visibility === "restricted" && <Badge variant="muted">{t("event.restricted")}</Badge>}
            {event.my_role && <Badge variant="default">{t(`role.event.${event.my_role}`)}</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-footnote text-fg-secondary">
            {event.location_name && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{event.location_name}</span>}
            <span className="inline-flex items-center gap-1 tnum"><CalendarRange className="size-3.5" aria-hidden />{fmtDate(event.starts_at, locale)} – {fmtDate(event.ends_at, locale)}</span>
            <span className="inline-flex items-center gap-1 tnum"><Users className="size-3.5" aria-hidden />{t("event.participantCount", { n: event.participant_count })}</span>
          </div>
        </div>
        <ChevronRight className="size-5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}
