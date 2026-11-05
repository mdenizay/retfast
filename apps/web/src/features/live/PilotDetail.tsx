import { Link } from "react-router";
import { Crosshair, ExternalLink, LocateFixed, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmtAccuracy, fmtAge, fmtAltitude, fmtCoord, fmtHeading, fmtSpeed, fmtTime, fmtVario } from "@/lib/format";
import { FreshnessBadge, RetrievalStatusBadge, SimBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PilotRow } from "./derive";
import type { CardContext } from "./RetrievalBoard";
import { useAgePhrase } from "./useAgePhrase";

export function PilotDetail({
  row, ctx, flightHref, follow, onFollow, onCenter, onClose, onOpenRetrieval,
}: {
  row: PilotRow;
  ctx: CardContext;
  flightHref: string | null;
  follow: boolean;
  onFollow: () => void;
  onCenter: () => void;
  onClose: () => void;
  onOpenRetrieval?: (id: string) => void;
}) {
  const { t, lang, locale } = useI18n();
  const phrase = useAgePhrase();
  const pilot = row.live;
  const p = pilot?.position;
  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-2 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <div className="text-caption text-fg-muted">{t(`phase.${row.phase}`)}</div>
          <div className="truncate text-headline font-semibold">{row.name}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {pilot && pilot.status === "recording" && <FreshnessBadge freshness={pilot.freshness} />}
            {pilot?.isSimulated && <SimBadge />}
            {pilot?.status === "ended" && <span className="text-caption text-fg-muted">{t("flight.status.ended")}</span>}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("live.deselect")}><X /></Button>
      </div>

      {row.retrieval && (
        <div className="border-b border-border bg-retrieval/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <RetrievalStatusBadge status={row.retrieval.status} />
            {onOpenRetrieval && (
              <button type="button" className="text-footnote font-medium text-fg underline decoration-fg/25 underline-offset-4 transition-colors hover:decoration-fg" onClick={() => onOpenRetrieval(row.retrieval!.id)}>
                {t("pdetail.openRetrieval")}
              </button>
            )}
          </div>
          <div className="mt-1.5 text-footnote tnum">{phrase(row.retrieval, ctx)}</div>
          {row.retrieval.retriever && <div className="text-caption text-fg-secondary">{t("pdetail.retriever", { name: row.retrieval.retriever.full_name })}</div>}
        </div>
      )}

      {pilot && p ? (
        <>
          <div className="border-b border-border p-4">
            <div className="text-caption text-fg-muted">{t("telemetry.age")}</div>
            <div className={cn("telemetry text-title1", pilot.freshness === "live" ? "text-fg" : pilot.freshness === "stale" ? "text-stale" : "text-offline")} aria-live="off">
              {fmtAge(pilot.ageS, lang)}
            </div>
            <div className="text-caption text-fg-muted telemetry">{t("telemetry.recordedAt", { time: fmtTime(p.t, locale) })}</div>
          </div>
          <dl className="grid grid-cols-2 border-b border-border">
            <Metric label={t("telemetry.gpsAlt")} value={fmtAltitude(p.gps_alt_m, locale)} />
            <Metric label={t("telemetry.groundSpeed")} value={fmtSpeed(p.speed_ms, locale)} />
            <Metric label={t("telemetry.varioEst")} value={fmtVario(pilot.varioEstimate, locale)} hint={t("telemetry.estimate")} />
            <Metric label={t("telemetry.heading")} value={fmtHeading(p.course_deg)} />
            <Metric label={t("telemetry.accuracy")} value={fmtAccuracy(p.h_acc_m, locale)} />
            <Metric label={t("telemetry.seq")} value={String(p.seq)} />
          </dl>
          <div className="border-b border-border px-4 py-3">
            <div className="text-caption text-fg-muted">{t("telemetry.position")}</div>
            <div className="telemetry text-footnote select-all">{fmtCoord(p.lat, p.lon)}</div>
          </div>
          <div className="grid grid-cols-2 gap-2 p-4">
            <Button variant={follow ? "default" : "outline"} onClick={onFollow} aria-pressed={follow}>
              <LocateFixed /> {follow ? t("live.following") : t("live.follow")}
            </Button>
            <Button variant="outline" onClick={onCenter}><Crosshair /> {t("live.center")}</Button>
            {flightHref && (
              <Button asChild variant="outline" className="col-span-2">
                <Link to={flightHref}><ExternalLink /> {t("live.openFlight")}</Link>
              </Button>
            )}
          </div>
        </>
      ) : (
        <p className="p-4 text-footnote text-fg-secondary">{row.phase === "not_started" ? t("pdetail.notStarted") : t("pdetail.noFlight")}</p>
      )}
      <p className="px-4 pb-4 text-caption text-fg-muted">{t("live.disclaimer")}</p>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-border p-4 odd:border-r [&:nth-child(n+3)]:border-t">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="telemetry text-title3 text-fg">{value}</dd>
      {hint && <dd className="text-caption text-fg-muted">{hint}</dd>}
    </div>
  );
}
