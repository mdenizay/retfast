import { Link } from "react-router";
import { Crosshair, ExternalLink, LocateFixed, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmtAccuracy, fmtAge, fmtAltitude, fmtCoord, fmtHeading, fmtSpeed, fmtTime, fmtVario } from "@/lib/format";
import { FreshnessBadge, RetrievalStatusBadge, SimBadge } from "@/components/status";
import { NameAvatar } from "@/components/common";
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
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <NameAvatar name={row.name} className="size-12" />
        <div className="min-w-0 flex-1">
          <div className="text-caption text-fg-muted">{t(`phase.${row.phase}`)}</div>
          <div className="truncate text-headline font-semibold">{row.name}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {pilot && pilot.status === "recording" && <FreshnessBadge freshness={pilot.freshness} />}
            {pilot?.isSimulated && <SimBadge />}
            {pilot?.status === "ended" && <span className="text-caption text-fg-muted">{t("flight.status.ended")}</span>}
          </div>
        </div>
        <Button variant="secondary" size="icon-sm" onClick={onClose} aria-label={t("live.deselect")}><X /></Button>
      </div>

      {row.retrieval && (
        <div className="rounded-2xl bg-retrieval/12 p-4">
          <div className="flex items-center justify-between gap-2">
            <RetrievalStatusBadge status={row.retrieval.status} />
            {onOpenRetrieval && (
              <button type="button" className="text-footnote font-semibold text-brand underline-offset-4 transition-colors hover:underline" onClick={() => onOpenRetrieval(row.retrieval!.id)}>
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
          <div className="rounded-2xl bg-muted p-4">
            <div className="text-caption text-fg-muted">{t("telemetry.age")}</div>
            <div className={cn("text-[34px] leading-tight font-semibold tracking-[-0.02em] tnum", pilot.freshness === "live" ? "text-fg" : pilot.freshness === "stale" ? "text-stale" : "text-offline")} aria-live="off">
              {fmtAge(pilot.ageS, lang)}
            </div>
            <div className="text-caption text-fg-muted telemetry">{t("telemetry.recordedAt", { time: fmtTime(p.t, locale) })}</div>
          </div>
          <dl className="grid grid-cols-2 gap-2">
            <Metric label={t("telemetry.gpsAlt")} value={fmtAltitude(p.gps_alt_m, locale)} />
            <Metric label={t("telemetry.groundSpeed")} value={fmtSpeed(p.speed_ms, locale)} />
            <Metric label={t("telemetry.varioEst")} value={fmtVario(pilot.varioEstimate, locale)} hint={t("telemetry.estimate")} />
            <Metric label={t("telemetry.heading")} value={fmtHeading(p.course_deg)} />
            <Metric label={t("telemetry.accuracy")} value={fmtAccuracy(p.h_acc_m, locale)} />
            <Metric label={t("telemetry.seq")} value={String(p.seq)} />
          </dl>
          <div className="rounded-2xl bg-muted px-4 py-3">
            <div className="text-caption text-fg-muted">{t("telemetry.position")}</div>
            <div className="telemetry text-footnote select-all">{fmtCoord(p.lat, p.lon)}</div>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button variant={follow ? "default" : "tinted"} onClick={onFollow} aria-pressed={follow}>
              <LocateFixed /> {follow ? t("live.following") : t("live.follow")}
            </Button>
            <Button variant="secondary" onClick={onCenter}><Crosshair /> {t("live.center")}</Button>
            {flightHref && (
              <Button asChild variant="secondary" className="col-span-2">
                <Link to={flightHref}><ExternalLink /> {t("live.openFlight")}</Link>
              </Button>
            )}
          </div>
        </>
      ) : (
        <p className="rounded-2xl bg-muted p-4 text-footnote text-fg-secondary">{row.phase === "not_started" ? t("pdetail.notStarted") : t("pdetail.noFlight")}</p>
      )}
      <p className="px-1 text-caption text-fg-muted">{t("live.disclaimer")}</p>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col-reverse rounded-2xl bg-muted p-4">
      <dt className="mt-0.5 text-caption text-fg-muted">{label}</dt>
      <dd className="text-title3 font-semibold text-fg tnum">{value}</dd>
      {hint && <dd className="text-caption text-fg-muted">{hint}</dd>}
    </div>
  );
}
