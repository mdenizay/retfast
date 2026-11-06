import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, ChevronDown, Download, Lock, Satellite } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { eventsApi, flightsApi } from "@/lib/api/endpoints";
import type { Flight, Position } from "@/lib/api/types";
import { useSession } from "@/lib/auth";
import { fmtAccuracy, fmtAltitude, fmtDateTime, fmtDistance, fmtDuration, fmtNumber, fmtPercent, fmtSpeed, fmtVario } from "@/lib/format";
import { EmptyState, ErrorState, FormError, Loading, NameAvatar, Stat } from "@/components/common";
import { cn } from "@/lib/utils";
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

      {/* Map hero with the three headline numbers floating over it (mirrors the iOS flight screen). */}
      <section className="relative overflow-hidden rounded-3xl bg-surface" aria-label={t("flight.route")}>
        <div className="h-[clamp(340px,58vh,640px)]">
          {positions.isLoading ? <Loading className="p-4" /> : positions.error ? <div className="p-4"><ErrorState error={positions.error} /></div> :
            pts.length === 0 ? <div className="grid h-full place-items-center p-4"><EmptyState title={t("flight.noPositions")} /></div> : (
              <MapCanvas label={t("flight.routeLabel")} initialCenter={[pts[0]!.lon, pts[0]!.lat]} initialZoom={11}>
                {(ready) => <FlightRouteLayers {...ready} positions={pts} />}
              </MapCanvas>
            )}
        </div>
        <HeroMetrics
          className="pointer-events-none absolute inset-x-3 bottom-3 sm:right-auto sm:bottom-4 sm:left-4"
          items={[
            [t("flight.duration"), fmtDuration(f.stats.duration_s)],
            [t("flight.distance"), fmtDistance(f.stats.distance_m, locale)],
            [t("flight.maxAltShort"), fmtAltitude(f.stats.max_gps_alt_m, locale)],
          ]}
        />
      </section>

      <StatGroups flight={f} positions={pts} />
      {pts.length > 1 && <FlightCharts positions={pts} />}
      <RecordingDetails flight={f} positions={pts} />
      <p className="text-caption text-fg-muted">{t("flight.altNote")}</p>
    </div>
  );
}

function HeroMetrics({ items, className }: { items: [string, string][]; className?: string }) {
  return (
    <dl className={cn("flex items-stretch divide-x divide-fg/10 rounded-2xl bg-surface/90 py-3 shadow-[0_8px_30px_rgb(0_0_0/0.18)] backdrop-blur-xl", className)}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0 flex-1 px-4 sm:min-w-32 sm:flex-none sm:px-5">
          <dt className="truncate text-caption text-fg-muted">{k}</dt>
          <dd className="truncate text-title3 font-semibold tracking-tight text-fg tnum">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Grouped value lists (distance / altitude / thermals); rows without a value are hidden, empty groups too. */
function StatGroups({ flight: f, positions }: { flight: Flight; positions: Position[] }) {
  const { t, locale } = useI18n();
  const s = useMemo(() => (positions.length > 1 ? paraStats(positions) : null), [positions]);
  const groups: { title: string; rows: [string, string, string?][] }[] = [
    {
      title: t("flight.group.distance"),
      rows: [
        [t("flight.distance"), fmtDistance(f.stats.distance_m, locale)],
        [t("flight.straight"), fmtDistance(s?.straightDistance, locale)],
        [t("flight.maxFrom"), fmtDistance(s?.maxFromTakeoff, locale)],
        [t("flight.avgSpeed"), fmtSpeed(s?.avgSpeed, locale)],
        [t("flight.maxSpeed"), fmtSpeed(f.stats.max_ground_speed_ms, locale)],
      ],
    },
    {
      title: t("flight.group.altitude"),
      rows: [
        [t("flight.maxAlt"), fmtAltitude(f.stats.max_gps_alt_m, locale)],
        [t("flight.takeoffAlt"), fmtAltitude(s?.takeoffAlt, locale)],
        [t("flight.landingAlt"), fmtAltitude(s?.landingAlt, locale)],
        [t("flight.ascent"), fmtAltitude(f.stats.total_ascent_m, locale)],
        [t("flight.descent"), fmtAltitude(f.stats.total_descent_m, locale)],
      ],
    },
    {
      title: t("flight.group.thermal"),
      rows: s
        ? [
            [t("flight.thermalCount"), fmtNumber(s.climbCount, locale), t("flight.thermalsHint")],
            [t("flight.bestClimb"), fmtVario(s.bestClimbAvg, locale)],
            [t("flight.maxClimb"), fmtVario(s.maxClimb, locale)],
            [t("flight.maxSink"), fmtVario(s.maxSink, locale)],
            [t("flight.climbShare"), fmtPercent(s.climbingShare, locale)],
          ]
        : [],
    },
  ];
  const shown = groups.map((g) => ({ ...g, rows: g.rows.filter(([, v]) => v !== "—") })).filter((g) => g.rows.length > 0);
  if (shown.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((g) => (
          <section key={g.title} className="min-w-0">
            <h2 className="mb-2 px-1 text-footnote font-semibold text-fg-secondary">{g.title}</h2>
            <dl className="divide-y divide-fg/[0.06] overflow-hidden rounded-3xl bg-surface">
              {g.rows.map(([k, v, h]) => (
                <div key={k} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <dt className="min-w-0 text-body text-fg-secondary">
                    {k}
                    {h && <span className="block text-caption text-fg-muted">{h}</span>}
                  </dt>
                  <dd className="shrink-0 text-body font-semibold text-fg tnum">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      {s && <p className="px-1 text-caption text-fg-muted">{t("flight.paraNote")}</p>}
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
    <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <NameAvatar name={f.pilot.full_name} className="size-14 bg-surface text-title3" />
        <div className="min-w-0">
          <h1 className="truncate text-title1 font-semibold tracking-[-0.02em]">
            {f.pilot.public_id && mode === "public" ? <Link to={`/pilots/${f.pilot.public_id}`} className="hover:underline">{f.pilot.full_name}</Link> : f.pilot.full_name}
          </h1>
          <p className="mt-0.5 text-footnote text-fg-secondary tnum">
            {fmtDateTime(f.started_at, locale)}{f.ended_at ? ` → ${fmtDateTime(f.ended_at, locale)}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <FlightStatusBadge status={f.status} />
            {f.is_simulated && <SimBadge />}
            <span className="telemetry text-caption text-fg-muted">#{f.public_id}</span>
            {f.device && <span className="text-caption text-fg-muted">{f.device.platform} {f.device.app_version}</span>}
          </div>
        </div>
      </div>
      <Button variant="secondary" className="shrink-0 self-start sm:self-center" onClick={downloadGpx}><Download /> {t("flight.gpx")}</Button>
      {mode === "app" && (f.event_id || isOwner) && (
        <p className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3 text-footnote text-fg-secondary sm:basis-full">
          <EventLine flight={f} eventName={event.data?.name} isOwner={isOwner} />
        </p>
      )}
      {dlError != null && <div className="w-full"><FormError error={dlError} /></div>}
    </header>
  );
}

function EventLine({ flight: f, eventName, isOwner }: { flight: Flight; eventName?: string; isOwner: boolean }) {
  const { t } = useI18n();
  if (f.event_id) {
    return (
      <>
        <CalendarRange className="size-4 shrink-0 text-fg-muted" aria-hidden />
        {eventName ? (
          <span>
            {t("flight.eventShared", { name: eventName })}{" "}
            <Link to={`/app/events/${f.event_id}`} className="font-semibold text-brand underline-offset-4 transition-colors hover:underline" aria-label={eventName}>→</Link>
          </span>
        ) : t("flight.eventSharedNoName")}
      </>
    );
  }
  return isOwner ? <><Lock className="size-4 shrink-0 text-fg-muted" aria-hidden />{t("flight.private")}</> : null;
}

function RecordingDetails({ flight: f, positions }: { flight: Flight; positions: Position[] }) {
  const { t, locale } = useI18n();
  const q = useMemo(() => gpsQuality(positions), [positions]);
  // Expected samples assume a 1 Hz target; faster sampling must not read as >100 % complete.
  const completeness = f.stats.expected_sample_count > 0 ? Math.min(1, f.stats.sample_count / f.stats.expected_sample_count) : null;
  return (
    <details className="group rounded-3xl bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-fg-secondary"><Satellite className="size-4" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-headline font-semibold">{t("flight.details")}</span>
          <span className="block text-caption text-fg-muted tnum">
            {t("flight.gpsQuality")} · {fmtPercent(completeness, locale)} · {fmtAccuracy(q.medianAcc, locale)}
          </span>
        </span>
        <ChevronDown className="size-5 text-fg-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-fg/[0.06] px-5 pt-4 pb-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label={t("flight.samples")} value={fmtNumber(f.stats.sample_count, locale)} hint={t("flight.expected", { n: fmtNumber(f.stats.expected_sample_count, locale) })} />
          <Stat label={t("flight.completeness")} value={fmtPercent(completeness, locale)} />
          <Stat label={t("flight.gaps")} value={fmtNumber(f.stats.gap_count, locale)} hint={t("flight.gapsHint")} />
          <Stat label={t("flight.medianAcc")} value={fmtAccuracy(q.medianAcc, locale)} />
          <Stat label={t("flight.p95Acc")} value={fmtAccuracy(q.p95Acc, locale)} />
          <Stat label={t("flight.poorFixes")} value={fmtPercent(q.poorRatio, locale)} hint={t("flight.poorHint")} />
        </div>
        {completeness !== null && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-accent" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(completeness * 100)} aria-label={t("flight.completeness")}>
            <div className="h-full bg-primary" style={{ width: `${Math.min(100, completeness * 100)}%` }} />
          </div>
        )}
        <p className="mt-4 text-caption text-fg-muted">{t("flight.qualityNote")}</p>
      </div>
    </details>
  );
}
