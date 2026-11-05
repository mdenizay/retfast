import { useQuery } from "@tanstack/react-query";
import { ArrowUp, CloudRain, Wind } from "lucide-react";
import { eventsApi } from "@/lib/api/endpoints";
import type { Flyability, RfEvent } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n";
import { fmtAltitude, fmtNumber, fmtSpeed, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Panel, Stat } from "@/components/common";
import { Badge } from "@/components/ui/badge";

const VARIANT: Record<Flyability, "success" | "warning" | "error" | "muted"> = { good: "success", marginal: "warning", poor: "error", unknown: "muted" };
const DOT: Record<Flyability, string> = { good: "bg-success", marginal: "bg-warning", poor: "bg-error", unknown: "bg-border" };

/** Arrow pointing where the wind blows to (meteorological direction + 180°). */
function WindArrow({ deg, className }: { deg: number | null; className?: string }) {
  if (deg == null) return null;
  return <ArrowUp className={cn("size-4 shrink-0", className)} style={{ transform: `rotate(${(deg + 180) % 360}deg)` }} aria-hidden />;
}

/** Open-Meteo forecast for the event centre with a coarse paragliding verdict. */
export function WeatherPanel({ event: e }: { event: Pick<RfEvent, "id" | "center"> }) {
  const { t, locale } = useI18n();
  const wx = useQuery({
    queryKey: ["weather", e.id],
    queryFn: () => eventsApi.weather(e.id),
    enabled: Boolean(e.center),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    retry: 1,
  });
  if (!e.center) return null;
  if (wx.isLoading) return <Panel title={t("wx.title")}><div className="h-24 animate-pulse rounded-md bg-accent" /></Panel>;
  if (wx.error || !wx.data) return <Panel title={t("wx.title")}><p className="text-footnote text-fg-muted">{t("wx.unavailable")}</p></Panel>;
  const w = wx.data;
  const now = w.hourly[0];
  const c = w.current;
  const ms = (v: number | null) => fmtSpeed(v, locale);
  return (
    <Panel title={t("wx.title")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={VARIANT[w.flyability]}>{t(`wx.${w.flyability}`)}</Badge>
        {w.fly_reasons.map((r) => <span key={r} className="text-caption text-fg-secondary">{t(`wx.r.${r}` as "wx.r.gusty")}</span>)}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
        <Stat label={t("wx.wind")} value={<span className="inline-flex items-center gap-1"><WindArrow deg={c.wind_dir_deg} />{ms(c.wind_ms)}</span>} />
        <Stat label={t("wx.gust")} value={ms(c.gust_ms)} />
        <Stat label={t("wx.temp")} value={c.temp_c == null ? "—" : `${fmtNumber(c.temp_c, locale)} °C`} />
        <Stat label={t("wx.cloudBase")} value={fmtAltitude(now?.cloud_base_m, locale)} />
        <Stat label={t("wx.aloft")} value={<span className="inline-flex items-center gap-1"><WindArrow deg={now?.wind_850_dir_deg ?? null} />{ms(now?.wind_850_ms ?? null)}</span>} />
        <Stat label={t("wx.rain")} value={now?.precip_prob_pct == null ? "—" : `${fmtNumber(now.precip_prob_pct, locale)} %`} />
      </div>
      {w.hourly.length > 1 && (
        <>
          <h3 className="mt-5 text-footnote font-medium text-fg-secondary">{t("wx.next")}</h3>
          <ol className="-mx-1 mt-2 flex gap-1 overflow-x-auto pb-1">
            {w.hourly.map((h) => (
              <li key={h.t} className="flex min-w-14 flex-col items-center gap-1 rounded-md px-1 py-2 text-caption">
                <span className="text-fg-muted">{fmtTime(h.t, locale, false)}</span>
                <span className={cn("size-2 rounded-full", DOT[h.flyability])} title={t(`wx.${h.flyability}`)} />
                <WindArrow deg={h.wind_dir_deg} className="text-fg-secondary" />
                <span className="telemetry tabular-nums">{h.wind_ms == null ? "—" : fmtNumber(h.wind_ms, locale)}<span className="text-fg-muted">/{h.gust_ms == null ? "—" : fmtNumber(h.gust_ms, locale)}</span></span>
                {h.precip_prob_pct != null && h.precip_prob_pct >= 20 && (
                  <span className="inline-flex items-center gap-0.5 text-secondary"><CloudRain className="size-3" aria-hidden />{fmtNumber(h.precip_prob_pct, locale)}</span>
                )}
              </li>
            ))}
          </ol>
          <p className="mt-1 inline-flex items-center gap-1 text-caption text-fg-muted"><Wind className="size-3" aria-hidden />m/s · {t("wx.wind")}/{t("wx.gust")}</p>
        </>
      )}
      <p className="mt-4 border-t border-border pt-3 text-caption text-fg-muted">
        {t("wx.note")} {t("wx.source")} <a href="https://open-meteo.com/" target="_blank" rel="noreferrer noopener" className="underline">Open-Meteo.com</a> (CC BY 4.0)
      </p>
    </Panel>
  );
}
