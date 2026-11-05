import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, Download, Lock, UserRound } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { eventsApi, flightsApi } from "@/lib/api/endpoints";
import type { Flight, Position } from "@/lib/api/types";
import { useSession } from "@/lib/auth";
import { fmtAccuracy, fmtAltitude, fmtDateTime, fmtDistance, fmtDuration, fmtNumber, fmtPercent, fmtSpeed, fmtVario } from "@/lib/format";
import { EmptyState, ErrorState, FormError, Loading, Panel, Stat } from "@/components/common";
import { FlightStatusBadge, SimBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { MapCanvas } from "@/components/map/MapCanvas";
import { FlightRouteLayers } from "./FlightRouteLayers";
import { FlightCharts } from "./FlightCharts";
import { gpsQuality } from "./quality";
import { paraStats } from "./paraStats";

export function FlightView({ idOrPublicId, mode }: { idOrPublicId: string; mode: "public" | "app" }) {
  const { t, locale } = useI18n();
  const flight = useQuery({
    queryKey: [mode === "public" ? "public" : "app", "flight", idOrPublicId],
    queryFn: () => flightsApi.get(idOrPublicId),
    refetchInterval: (q) => (q.state.data?.status === "recording" ? 15_000 : false),
  });
  const f = flight.data;
  const positions = useQuery({
    queryKey: [mode === "public" ? "public" : "app", "flight-positions", f?.id, f?.stats.sample_count],
    queryFn: () => flightsApi.positions(f!.id, { simplify: false }),
    enabled: Boolean(f?.id),
  });

  if (flight.isLoading) return <Loading />;
  if (flight.error || !f) return <ErrorState error={flight.error} onRetry={() => void flight.refetch()} />;

  const pts = positions.data ?? [];
  return (
    <div className="space-y-6">
      <FlightHeader flight={f} mode={mode} />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {[
          [t("flight.duration"), fmtDuration(f.stats.duration_s)],
          [t("flight.distance"), fmtDistance(f.stats.distance_m, locale)],
          [t("flight.maxAlt"), fmtAltitude(f.stats.max_gps_alt_m, locale)],
          [t("flight.maxSpeed"), fmtSpeed(f.stats.max_ground_speed_ms, locale)],
          [t("flight.ascent"), fmtAltitude(f.stats.total_ascent_m, locale)],
          [t("flight.descent"), fmtAltitude(f.stats.total_descent_m, locale)],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface p-4"><Stat label={k} value={v} /></div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Panel title={t("flight.route")} bodyClassName="p-0">
          <div className="h-[420px]">
            {positions.isLoading ? <Loading className="p-4" /> : positions.error ? <div className="p-4"><ErrorState error={positions.error} /></div> :
              pts.length === 0 ? <div className="p-4"><EmptyState title={t("flight.noPositions")} /></div> : (
                <MapCanvas label={t("flight.routeLabel")} initialCenter={[pts[0]!.lon, pts[0]!.lat]} initialZoom={11}>
                  {(ready) => <FlightRouteLayers {...ready} positions={pts} />}
                </MapCanvas>
              )}
          </div>
        </Panel>
        <GpsQualityPanel flight={f} positions={pts} />
      </div>

      {pts.length > 1 && <ParaPanel positions={pts} />}
      {pts.length > 1 && <FlightCharts positions={pts} />}
      <p className="text-caption text-fg-muted">{t("flight.altNote")}</p>
    </div>
  );
}

function FlightHeader({ flight: f, mode }: { flight: Flight; mode: "public" | "app" }) {
  const { t, locale } = useI18n();
  const { user } = useSession();
  const isOwner = user?.id === f.pilot.user_id;
  const [dlError, setDlError] = useState<unknown>(null);
  // Event name is a nicety; a failed lookup (e.g. no access) just falls back to a generic line.
  const event = useQuery({
    queryKey: ["app", "event", f.event_id],
    queryFn: () => eventsApi.get(f.event_id!),
    enabled: mode === "app" && Boolean(f.event_id),
    retry: false,
    staleTime: 60_000,
  });

  async function downloadGpx() {
    setDlError(null);
    try {
      const res = await flightsApi.gpx(f.id);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `retfast-${f.public_id}.gpx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setDlError(e);
    }
  }

  return (
    <div className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <FlightStatusBadge status={f.status} />
          {f.is_simulated && <SimBadge />}
          <span className="telemetry text-caption text-fg-muted">#{f.public_id}</span>
        </div>
        <h1 className="mt-2 flex items-center gap-2 text-title2 font-semibold tracking-tight">
          <UserRound className="size-6 text-fg-muted" aria-hidden />
          {f.pilot.public_id && mode === "public" ? <Link to={`/pilots/${f.pilot.public_id}`} className="hover:underline">{f.pilot.full_name}</Link> : f.pilot.full_name}
        </h1>
        <p className="mt-1 text-footnote text-fg-secondary tnum">
          {fmtDateTime(f.started_at, locale)}{f.ended_at ? ` → ${fmtDateTime(f.ended_at, locale)}` : ""}
          {f.device ? ` · ${f.device.platform} ${f.device.app_version}` : ""}
        </p>
        {mode === "app" && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-footnote text-fg-secondary">
            {f.event_id ? (
              <>
                <CalendarRange className="size-4 text-fg-muted" aria-hidden />
                {event.data ? (
                  <span>
                    {t("flight.eventShared", { name: event.data.name })}{" "}
                    <Link to={`/app/events/${f.event_id}`} className="text-fg underline decoration-fg/25 underline-offset-4 transition-colors hover:decoration-fg" aria-label={event.data.name}>→</Link>
                  </span>
                ) : t("flight.eventSharedNoName")}
              </>
            ) : isOwner ? (
              <><Lock className="size-4 text-fg-muted" aria-hidden />{t("flight.private")}</>
            ) : null}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={downloadGpx}><Download /> {t("flight.gpx")}</Button>
      </div>
      {dlError != null && <div className="w-full"><FormError error={dlError} /></div>}
    </div>
  );
}

function GpsQualityPanel({ flight: f, positions }: { flight: Flight; positions: Position[] }) {
  const { t, locale } = useI18n();
  const q = useMemo(() => gpsQuality(positions), [positions]);
  // Expected samples assume a 1 Hz target; faster sampling must not read as >100 % complete.
  const completeness = f.stats.expected_sample_count > 0 ? Math.min(1, f.stats.sample_count / f.stats.expected_sample_count) : null;
  return (
    <Panel title={t("flight.gpsQuality")}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <Stat label={t("flight.samples")} value={fmtNumber(f.stats.sample_count, locale)} hint={t("flight.expected", { n: fmtNumber(f.stats.expected_sample_count, locale) })} />
        <Stat label={t("flight.completeness")} value={fmtPercent(completeness, locale)} />
        <Stat label={t("flight.gaps")} value={fmtNumber(f.stats.gap_count, locale)} hint={t("flight.gapsHint")} />
        <Stat label={t("flight.medianAcc")} value={fmtAccuracy(q.medianAcc, locale)} />
        <Stat label={t("flight.p95Acc")} value={fmtAccuracy(q.p95Acc, locale)} />
        <Stat label={t("flight.poorFixes")} value={fmtPercent(q.poorRatio, locale)} hint={t("flight.poorHint")} />
      </div>
      {completeness !== null && (
        <div className="mt-5">
          <div className="h-2 overflow-hidden rounded-full bg-accent" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(completeness * 100)} aria-label={t("flight.completeness")}>
            <div className="h-full bg-primary" style={{ width: `${Math.min(100, completeness * 100)}%` }} />
          </div>
        </div>
      )}
      <p className="mt-4 text-caption text-fg-muted">{t("flight.qualityNote")}</p>
    </Panel>
  );
}

function ParaPanel({ positions }: { positions: Position[] }) {
  const { t, locale } = useI18n();
  const s = useMemo(() => paraStats(positions), [positions]);
  if (!s) return null;
  const items: [string, string, string?][] = [
    [t("flight.thermals"), fmtNumber(s.climbCount, locale), t("flight.thermalsHint")],
    [t("flight.bestClimb"), fmtVario(s.bestClimbAvg, locale)],
    [t("flight.maxClimb"), fmtVario(s.maxClimb, locale)],
    [t("flight.maxSink"), fmtVario(s.maxSink, locale)],
    [t("flight.climbShare"), fmtPercent(s.climbingShare, locale)],
    [t("flight.avgSpeed"), fmtSpeed(s.avgSpeed, locale)],
    [t("flight.straight"), fmtDistance(s.straightDistance, locale)],
    [t("flight.maxFrom"), fmtDistance(s.maxFromTakeoff, locale)],
    [t("flight.takeoffAlt"), fmtAltitude(s.takeoffAlt, locale)],
    [t("flight.landingAlt"), fmtAltitude(s.landingAlt, locale)],
  ];
  return (
    <Panel title={t("flight.para")}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
        {items.map(([k, v, h]) => <Stat key={k} label={k} value={v} hint={h} />)}
      </div>
      <p className="mt-4 text-caption text-fg-muted">{t("flight.paraNote")}</p>
    </Panel>
  );
}
