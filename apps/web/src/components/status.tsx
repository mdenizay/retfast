/**
 * Safety-state indicators. Rule: never color alone — every state = icon + text label + color.
 */
import { CircleDot, Clock3, LocateOff, CloudOff, Siren, FlaskConical, CheckCircle2, CircleSlash, Radio, Loader2 } from "lucide-react";
import type { Freshness, IncidentStatus, FlightStatus } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "@/features/live/realtime";

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

export function TestBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <Badge variant="warning" className={cn("font-mono tracking-wider", className)} title={t("incident.testTitle")}>
      <FlaskConical aria-hidden />
      TEST
    </Badge>
  );
}

export function IncidentStatusBadge({ status, isTest = false }: { status: IncidentStatus; isTest?: boolean }) {
  const { t } = useI18n();
  const conf: Record<IncidentStatus, { Icon: typeof Siren; variant: "emergency" | "warning" | "primary" | "success" | "muted" }> = {
    open: { Icon: Siren, variant: "emergency" },
    acknowledged: { Icon: CheckCircle2, variant: "warning" },
    responding: { Icon: Radio, variant: "primary" },
    resolved: { Icon: CheckCircle2, variant: "success" },
    cancelled: { Icon: CircleSlash, variant: "muted" },
  };
  const c = conf[status];
  // TEST incidents never use the emergency fill (design-system §6).
  const variant = isTest && c.variant === "emergency" ? "warning" : c.variant;
  return (
    <Badge variant={variant} data-status={status}>
      <c.Icon aria-hidden />
      {t(`incident.status.${status}`)}
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
