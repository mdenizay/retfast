/**
 * State indicators. Rule: never color alone — every state = icon + text label + color.
 */
import { CheckCircle2, CircleDot, CircleSlash, Clock3, CloudOff, FlaskConical, Hourglass, Loader2, LocateOff, Radio, XCircle } from "lucide-react";
import type { ApplicationStatus, Freshness, FlightStatus, RetrievalStatus } from "@/lib/api/types";
import type { EventBadgeRole } from "@/lib/roles";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "@/features/live/realtime";
import { RETRIEVAL_ICON, ROLE_ICON } from "./stateIcons";

export function FreshnessBadge({ freshness, className }: { freshness: Freshness | "offline"; className?: string }) {
  const { t } = useI18n();
  const map = {
    live: { Icon: CircleDot, label: t("fresh.live"), cls: "border-live/50 bg-live/10 text-live" },
    stale: { Icon: Clock3, label: t("fresh.stale"), cls: "border-stale/60 bg-stale/10 text-stale" },
    lost: { Icon: LocateOff, label: t("fresh.lost"), cls: "border-dashed border-offline/70 bg-transparent text-offline" },
    offline: { Icon: CloudOff, label: t("fresh.offline"), cls: "border-offline/60 bg-transparent text-offline" },
  }[freshness];
  return (
    <Badge className={cn(map.cls, className)} data-freshness={freshness}>
      <map.Icon aria-hidden />
      {map.label}
    </Badge>
  );
}

export function SimBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <Badge variant="sim" className={className} title={t("sim.title")}>
      <FlaskConical aria-hidden />
      SIM
    </Badge>
  );
}

/** Event role chip: organizer / pilot / observer / retriever. Icon + label; color is secondary information. */
export function RoleBadge({ role, className }: { role: EventBadgeRole; className?: string }) {
  const { t } = useI18n();
  const Icon = ROLE_ICON[role];
  const variant = role === "organizer" ? "primary" : role === "retriever" ? "retrieval" : role === "observer" ? "secondary" : "default";
  return (
    <Badge variant={variant} className={className} data-role={role}>
      <Icon aria-hidden />
      {t(`role.${role}`)}
    </Badge>
  );
}

export function RetrievalStatusBadge({ status, className }: { status: RetrievalStatus; className?: string }) {
  const { t } = useI18n();
  const Icon = RETRIEVAL_ICON[status];
  const variant = ({ requested: "retrieval", accepted: "secondary", picked_up: "primary", delivered: "success", cancelled: "muted" } as const)[status];
  return (
    <Badge variant={variant} className={className} data-status={status}>
      <Icon aria-hidden />
      {t(`retrieval.status.${status}`)}
    </Badge>
  );
}

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const { t } = useI18n();
  const conf = {
    pending: { Icon: Hourglass, variant: "warning" },
    approved: { Icon: CheckCircle2, variant: "success" },
    rejected: { Icon: XCircle, variant: "error" },
    withdrawn: { Icon: CircleSlash, variant: "muted" },
  } as const;
  const c = conf[status];
  return (
    <Badge variant={c.variant} data-status={status}>
      <c.Icon aria-hidden />
      {t(`application.status.${status}`)}
    </Badge>
  );
}

export function FlightStatusBadge({ status }: { status: FlightStatus }) {
  const { t } = useI18n();
  if (status === "recording")
    return (
      <Badge variant="primary">
        <Radio aria-hidden />
        {t("flight.status.recording")}
      </Badge>
    );
  return (
    <Badge variant="muted">
      {status === "ended" ? <CheckCircle2 aria-hidden /> : <CircleSlash aria-hidden />}
      {t(`flight.status.${status}`)}
    </Badge>
  );
}

export function ConnectionIndicator({ status, attempt }: { status: ConnectionStatus; attempt: number }) {
  const { t } = useI18n();
  if (status === "open")
    return (
      <span className="inline-flex items-center gap-1.5 text-footnote text-live" role="status">
        <Radio className="size-4" aria-hidden />
        {t("conn.open")}
      </span>
    );
  if (status === "reconnecting")
    return (
      <span className="inline-flex items-center gap-1.5 text-footnote text-stale" role="status">
        <CloudOff className="size-4" aria-hidden />
        {t("conn.reconnectingShort", { n: attempt })}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-footnote text-fg-muted" role="status">
      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      {t("conn.connecting")}
    </span>
  );
}
