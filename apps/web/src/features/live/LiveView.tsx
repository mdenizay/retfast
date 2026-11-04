import { useDeferredValue, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Crosshair, ExternalLink, LocateFixed, Navigation2, Search, Siren, Users, WifiOff, X,
} from "lucide-react";
import type { RfEvent } from "@/lib/api/types";
import { incidentsApi } from "@/lib/api/endpoints";
import { useI18n } from "@/lib/i18n";
import { fmtAccuracy, fmtAge, fmtAltitude, fmtCoord, fmtHeading, fmtSpeed, fmtTime, fmtVario } from "@/lib/format";
import { hasRole, useSession } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { MapCanvas } from "@/components/map/MapCanvas";
import { ConnectionIndicator, FreshnessBadge, SimBadge } from "@/components/status";
import { ErrorState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLiveEvent } from "./useLiveEvent";
import { LiveMapLayers } from "./LiveMapLayers";
import type { LivePilotView } from "./store";

type Filter = "all" | "live" | "stale" | "lost" | "sim" | "incident";

interface Props {
  event: RfEvent;
  mode: "public" | "app";
  backHref: string;
}

export function LiveView({ event, mode, backHref }: Props) {
  const { t, locale } = useI18n();
  const { user } = useSession();
  const live = useLiveEvent(event.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [centerRequest, setCenterRequest] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [mobileTab, setMobileTab] = useState<"list" | "detail">("list");
  const [sheetOpen, setSheetOpen] = useState(false);
  const dq = useDeferredValue(query);

  const canSeeIncidents =
    mode === "app" && (hasRole(user, "platform_admin", "rescue_operator") || event.my_role === "organizer");
  const incidents = useQuery({
    queryKey: ["incidents", "event", event.id],
    queryFn: () => incidentsApi.list({ status: "open,acknowledged,responding", event_id: event.id }),
    enabled: canSeeIncidents,
    refetchInterval: 15_000,
  });
  const incidentFlightIds = useMemo(
    () => new Set((incidents.data?.items ?? []).map((i) => i.flight_id).filter((x): x is string => Boolean(x))),
    [incidents.data],
  );

  const counts = useMemo(() => {
    const c = { live: 0, stale: 0, lost: 0, sim: 0 };
    for (const p of live.pilots) {
      c[p.freshness] += 1;
      if (p.isSimulated) c.sim += 1;
    }
    return c;
  }, [live.pilots]);

  const filtered = useMemo(() => {
    const q = dq.trim().toLocaleLowerCase(locale);
    const order = { live: 0, stale: 1, lost: 2 } as const;
    return live.pilots
      .filter((p) => {
        if (filter === "live" || filter === "stale" || filter === "lost") { if (p.freshness !== filter) return false; }
        else if (filter === "sim") { if (!p.isSimulated) return false; }
        else if (filter === "incident") { if (!incidentFlightIds.has(p.flightId)) return false; }
        if (!q) return true;
        return (
          (p.pilot?.full_name ?? "").toLocaleLowerCase(locale).includes(q) ||
          (p.pilot?.public_id ?? "").toLocaleLowerCase(locale).includes(q)
        );
      })
      .sort((a, b) => {
        const ia = incidentFlightIds.has(a.flightId) ? -1 : 0;
        const ib = incidentFlightIds.has(b.flightId) ? -1 : 0;
        return ia - ib || order[a.freshness] - order[b.freshness] || (a.pilot?.full_name ?? "").localeCompare(b.pilot?.full_name ?? "", locale);
      });
  }, [live.pilots, filter, dq, locale, incidentFlightIds]);

  const selected = live.pilots.find((p) => p.flightId === selectedId) ?? null;

  const select = (id: string | null) => {
    setSelectedId(id);
    if (id) {
      setMobileTab("detail");
      setSheetOpen(true);
    } else setFollow(false);
  };

  const disconnected = live.connection === "reconnecting";

  const filters: { id: Filter; label: string; count?: number; show?: boolean }[] = [
    { id: "all", label: t("live.filter.all"), count: live.pilots.length },
    { id: "live", label: t("fresh.live"), count: counts.live },
    { id: "stale", label: t("fresh.stale"), count: counts.stale },
    { id: "lost", label: t("fresh.lost"), count: counts.lost },
    { id: "sim", label: "SIM", count: counts.sim },
    { id: "incident", label: t("live.filter.incident"), count: incidentFlightIds.size, show: canSeeIncidents },
  ];

  const listPane = (
    <PilotList
      pilots={filtered}
      total={live.pilots.length}
      selectedId={selectedId}
      onSelect={select}
      query={query}
      setQuery={setQuery}
      filter={filter}
      setFilter={setFilter}
      filters={filters.filter((f) => f.show !== false)}
      incidentFlightIds={incidentFlightIds}
      loading={live.isLoading}
    />
  );

  const detailPane = (
    <PilotDetail
      pilot={selected}
      mode={mode}
      hasIncident={selected ? incidentFlightIds.has(selected.flightId) : false}
      follow={follow}
      onFollow={() => setFollow((f) => !f)}
      onCenter={() => setCenterRequest((n) => n + 1)}
      onClose={() => select(null)}
    />
  );

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 sm:px-4">
        <Button asChild variant="ghost" size="icon-sm" aria-label={t("common.back")}>
          <Link to={backHref}><ArrowLeft /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-headline font-semibold">{event.name}</h1>
            {event.is_demo && <span className="rounded-[6px] border border-secondary/60 px-1.5 text-caption font-medium text-secondary">DEMO</span>}
          </div>
          <div className="hidden truncate text-caption text-fg-muted sm:block">
            {event.location_name} · {t(`event.status.${event.status}`)}
          </div>
        </div>
        <div className="hidden items-center gap-4 text-footnote md:flex tnum" aria-label={t("live.counts")}>
          <span className="text-live">{counts.live} {t("fresh.live").toLocaleLowerCase(locale)}</span>
          <span className="text-stale">{counts.stale} {t("fresh.stale").toLocaleLowerCase(locale)}</span>
          <span className="text-offline">{counts.lost} {t("fresh.lost").toLocaleLowerCase(locale)}</span>
        </div>
        <div className="flex flex-col items-end">
          <ConnectionIndicator status={live.connection} attempt={live.reconnectAttempt} />
          {live.lastSnapshotAt && (
            <span className="hidden text-caption text-fg-muted sm:block telemetry">
              {t("live.snapshotAt", { time: fmtTime(live.lastSnapshotAt, locale) })}
            </span>
          )}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Left pane (desktop) */}
        <aside className="hidden w-80 shrink-0 flex-col border-r border-border bg-surface lg:flex" aria-label={t("live.pilots")}>
          {listPane}
        </aside>

        {/* Map */}
        <main className="relative min-w-0 flex-1">
          <MapCanvas
            label={t("live.mapLabel", { name: event.name })}
            initialCenter={event.center ? [event.center.lon, event.center.lat] : undefined}
            initialZoom={event.center ? 11 : 5}
          >
            {(ready) => (
              <LiveMapLayers
                {...ready}
                pilots={live.pilots}
                selectedId={selectedId}
                incidentFlightIds={incidentFlightIds}
                follow={follow}
                centerRequest={centerRequest}
                fallbackCenter={event.center}
                onSelect={select}
              />
            )}
          </MapCanvas>

          {disconnected && (
            <div role="status" aria-live="polite" className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border border-stale/60 bg-surface px-3 py-2 text-footnote text-fg shadow-[0_2px_8px_rgb(0_0_0/0.12)]">
              <WifiOff className="size-4 text-stale" aria-hidden />
              {t("conn.reconnecting", { n: live.reconnectAttempt })}
            </div>
          )}
          {live.snapshotError != null && (
            <div className="absolute top-16 left-1/2 z-10 w-[min(92%,28rem)] -translate-x-1/2">
              <ErrorState error={live.snapshotError} onRetry={() => void live.refetch()} className="bg-surface" />
            </div>
          )}
          {!live.isLoading && live.pilots.length === 0 && live.snapshotError == null && (
            <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center px-4">
              <div className="pointer-events-auto max-w-sm rounded-md border border-border bg-surface px-4 py-3 text-center text-footnote text-fg-secondary">
                <div className="font-medium text-fg">{t("live.empty.title")}</div>
                <div>{mode === "public" ? t("live.empty.public") : t("live.empty.app")}</div>
              </div>
            </div>
          )}

          {/* Mobile quick toggle */}
          <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 lg:hidden">
            {!sheetOpen && (
              <Button variant="outline" onClick={() => setSheetOpen(true)} className="shadow-[0_2px_8px_rgb(0_0_0/0.12)]">
                <Users /> {t("live.pilots")} · <span className="tnum">{live.pilots.length}</span>
              </Button>
            )}
          </div>
        </main>

        {/* Right pane (desktop) */}
        <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-surface xl:flex" aria-label={t("live.detail")}>
          {detailPane}
        </aside>

        {/* Mobile / tablet bottom sheet */}
        {sheetOpen && (
          <div className="absolute inset-x-0 bottom-0 z-20 flex max-h-[62dvh] min-h-[40dvh] flex-col rounded-t-xl border-t border-border bg-surface xl:hidden">
            <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
              <div role="tablist" className="flex flex-1 gap-1 lg:hidden">
                <SheetTab active={mobileTab === "list"} onClick={() => setMobileTab("list")}>{t("live.pilots")}</SheetTab>
                <SheetTab active={mobileTab === "detail"} onClick={() => setMobileTab("detail")}>{t("live.detail")}</SheetTab>
              </div>
              <div className="hidden flex-1 px-2 text-footnote font-medium lg:block">{t("live.detail")}</div>
              <Button variant="ghost" size="icon-sm" aria-label={t("common.close")} onClick={() => setSheetOpen(false)}>
                <X />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className={cn("min-h-0 flex-1 flex-col lg:hidden", mobileTab === "list" ? "flex" : "hidden")}>{listPane}</div>
              <div className={cn("min-h-0 flex-1 flex-col overflow-y-auto", mobileTab === "detail" ? "flex" : "hidden lg:flex")}>{detailPane}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SheetTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn("h-10 flex-1 rounded-sm text-footnote font-medium", active ? "bg-accent text-fg" : "text-fg-muted hover:text-fg")}
    >
      {children}
    </button>
  );
}

/* ---------------- Pilot list ---------------- */

const ROW_H = 60;

function PilotList(props: {
  pilots: LivePilotView[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  setQuery: (q: string) => void;
  filter: Filter;
  setFilter: (f: Filter) => void;
  filters: { id: Filter; label: string; count?: number }[];
  incidentFlightIds: Set<string>;
  loading: boolean;
}) {
  const { t, lang, locale } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  // Simple fixed-height windowing keeps 2000+ rows cheap.
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 8);
  const end = Math.min(props.pilots.length, Math.ceil((scrollTop + viewH) / ROW_H) + 8);
  const rows = props.pilots.slice(start, end);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input
            value={props.query}
            onChange={(e) => props.setQuery(e.target.value)}
            placeholder={t("live.search")}
            aria-label={t("live.search")}
            className="h-11 pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("live.filters")}>
          {props.filters.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={props.filter === f.id}
              onClick={() => props.setFilter(f.id)}
              className={cn(
                "inline-flex h-9 items-center gap-1 rounded-sm border px-2.5 text-footnote font-medium tnum transition-colors",
                props.filter === f.id ? "border-fg bg-fg text-background" : "border-border text-fg-secondary hover:bg-accent",
              )}
            >
              {f.label}
              {f.count !== undefined && <span className="opacity-70">{f.count}</span>}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={(el) => {
          scroller.current = el;
          if (el && el.clientHeight && el.clientHeight !== viewH) setViewH(el.clientHeight);
        }}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {props.pilots.length === 0 ? (
          <div className="p-6 text-center text-footnote text-fg-muted">
            {props.loading ? t("common.loading") : props.total === 0 ? t("live.empty.title") : t("live.noMatch")}
          </div>
        ) : (
          <ul style={{ height: props.pilots.length * ROW_H, position: "relative" }} aria-label={t("live.pilots")}>
            {rows.map((p, i) => {
              const sel = p.flightId === props.selectedId;
              const incident = props.incidentFlightIds.has(p.flightId);
              return (
                <li key={p.flightId} style={{ position: "absolute", top: (start + i) * ROW_H, left: 0, right: 0, height: ROW_H }}>
                  <button
                    type="button"
                    onClick={() => props.onSelect(p.flightId)}
                    aria-current={sel ? "true" : undefined}
                    className={cn(
                      "flex h-full w-full items-center gap-3 border-b border-border px-3 text-left transition-colors",
                      sel ? "bg-primary/10" : "hover:bg-accent",
                      p.freshness === "lost" && "opacity-80",
                    )}
                  >
                    <FreshGlyph freshness={p.freshness} heading={p.position.course_deg} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-body font-medium">{p.pilot?.full_name || p.pilot?.public_id}</span>
                        {p.isSimulated && <SimBadge className="py-0" />}
                        {incident && (
                          <span className="inline-flex items-center gap-0.5 rounded-[6px] bg-emergency px-1 text-caption font-semibold text-on-emergency">
                            <Siren className="size-3" aria-hidden />SOS
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2 text-caption text-fg-muted telemetry">
                        <span>{fmtAltitude(p.position.gps_alt_m, locale)}</span>
                        <span>{fmtSpeed(p.position.speed_ms, locale)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={cn("text-caption font-medium", p.freshness === "live" ? "text-live" : p.freshness === "stale" ? "text-stale" : "text-offline")}>
                        {t(`fresh.${p.freshness}`)}
                      </div>
                      <div className="telemetry text-caption text-fg-muted">{fmtAge(p.ageS, lang)}</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function FreshGlyph({ freshness, heading }: { freshness: LivePilotView["freshness"]; heading: number | null }) {
  const cls = freshness === "live" ? "text-live fill-live" : freshness === "stale" ? "text-stale fill-transparent" : "text-offline fill-transparent";
  return (
    <span className="grid size-8 shrink-0 place-items-center" aria-hidden>
      <Navigation2
        className={cn("size-5", cls, freshness === "lost" && "[stroke-dasharray:3_2]")}
        style={{ transform: `rotate(${heading ?? 0}deg)` }}
        strokeWidth={2}
      />
    </span>
  );
}

/* ---------------- Pilot detail ---------------- */

function PilotDetail({
  pilot, mode, hasIncident, follow, onFollow, onCenter, onClose,
}: {
  pilot: LivePilotView | null;
  mode: "public" | "app";
  hasIncident: boolean;
  follow: boolean;
  onFollow: () => void;
  onCenter: () => void;
  onClose: () => void;
}) {
  const { t, lang, locale } = useI18n();
  if (!pilot) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-footnote text-fg-muted">
        <Crosshair className="size-6" aria-hidden />
        {t("live.selectPilot")}
      </div>
    );
  }
  const p = pilot.position;
  const flightHref = mode === "app" ? `/app/flights/${pilot.flightId}` : `/flights/${pilot.flightId}`;
  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-2 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-headline font-semibold">{pilot.pilot?.full_name || pilot.pilot?.public_id}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <FreshnessBadge freshness={pilot.freshness} />
            {pilot.isSimulated && <SimBadge />}
            {pilot.status === "ended" && <span className="text-caption text-fg-muted">{t("flight.status.ended")}</span>}
            {hasIncident && (
              <span className="inline-flex items-center gap-1 rounded-[6px] bg-emergency px-1.5 py-0.5 text-caption font-semibold text-on-emergency">
                <Siren className="size-3.5" aria-hidden />{t("live.openIncident")}
              </span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("live.deselect")} className="hidden xl:inline-flex">
          <X />
        </Button>
      </div>

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
        <Button variant="outline" onClick={onCenter}>
          <Crosshair /> {t("live.center")}
        </Button>
        <Button asChild variant="outline" className="col-span-2">
          <Link to={flightHref}><ExternalLink /> {t("live.openFlight")}</Link>
        </Button>
      </div>
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
