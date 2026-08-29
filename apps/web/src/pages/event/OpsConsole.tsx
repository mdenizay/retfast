import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap } from "maplibre-gl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import MapView from "@/components/MapView";
import { PilotRow, RetrieverRow } from "@/components/OpsRows";
import { BatteryGauge, FreshnessDot, HeadingDial, Stat } from "@/components/Telemetry";
import { useI18n } from "@/i18n";
import {
  ageSeconds,
  fmtAccuracy,
  fmtAgo,
  fmtAltitude,
  fmtDateTime,
  fmtDuration,
  fmtSpeed,
} from "@/lib/format";
import { parseWkbPoint } from "@/lib/geo";
import { supabase } from "@/lib/supabase";
import {
  nextAssignmentActions,
  useOpsLive,
  type PilotLive,
  type RetrieverLive,
} from "@/lib/useOpsLive";
import type { AssignmentStatus } from "@/lib/types";
import { ArrowLeft, Car, ChevronLeft, PlaneTakeoff, Radio, Search, Siren } from "lucide-react";

type Selection = { kind: "pilot"; id: string } | { kind: "retriever"; id: string } | null;

export default function OpsConsole() {
  const { id: eventId } = useParams<{ id: string }>();
  const { m, locale } = useI18n();
  const { event, zones, pilots, retrievers, emergencies, names, isOperator, live, reload } =
    useOpsLive(eventId);

  const [selection, setSelection] = useState<Selection>(null);
  const [rosterOpen, setRosterOpen] = useState(true);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [, setTick] = useState(0);

  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const selectRef = useRef<(s: Selection) => void>(() => {});
  selectRef.current = (s) => setSelection(s);

  // Tick every second so "last fix" ages advance without refetching.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Imperative marker sync — avoids re-rendering the map for every fix.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const markers = markersRef.current;
    const keep = new Set<string>();

    const upsert = (key: string, lng: number, lat: number, build: () => HTMLElement) => {
      keep.add(key);
      const existing = markers.get(key);
      if (existing) {
        existing.setLngLat([lng, lat]);
        existing.getElement().replaceChildren(...Array.from(build().childNodes));
      } else {
        markers.set(
          key,
          new maplibregl.Marker({ element: build() }).setLngLat([lng, lat]).addTo(map),
        );
      }
    };

    for (const p of pilots) {
      if (!p.fix) continue;
      upsert(`pilot:${p.task.id}`, p.fix.lng, p.fix.lat, () =>
        pilotMarker(p, () => selectRef.current({ kind: "pilot", id: p.task.id })),
      );
    }
    for (const r of retrievers) {
      if (!r.pos || r.availability === "offline") continue;
      upsert(`ret:${r.user_id}`, r.pos.lng, r.pos.lat, () =>
        retrieverMarker(r, () => selectRef.current({ kind: "retriever", id: r.user_id })),
      );
    }
    for (const e of emergencies) {
      const pos = parseWkbPoint(e.geom);
      if (!pos) continue;
      upsert(`sos:${e.id}`, pos.lng, pos.lat, () => sosMarker(() => setEmergencyOpen(true)));
    }

    for (const [key, marker] of markers) {
      if (!keep.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    }
  }, [pilots, retrievers, emergencies, mapReady]);

  // Frame the whole operation once, when data first lands.
  const framedRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || framedRef.current) return;
    const coords: [number, number][] = [
      ...pilots.filter((p) => p.fix).map((p) => [p.fix!.lng, p.fix!.lat] as [number, number]),
      ...retrievers.filter((r) => r.pos).map((r) => [r.pos!.lng, r.pos!.lat] as [number, number]),
    ];
    if (coords.length === 0) return;
    const b = coords.reduce(
      (acc, c) => acc.extend(c),
      new maplibregl.LngLatBounds(coords[0], coords[0]),
    );
    map.fitBounds(b, { padding: { top: 120, bottom: 120, left: 380, right: 420 }, maxZoom: 13 });
    framedRef.current = true;
  }, [pilots, retrievers, mapReady]);

  const selectedPilot = useMemo(
    () => (selection?.kind === "pilot" ? pilots.find((p) => p.task.id === selection.id) : undefined),
    [selection, pilots],
  );
  const selectedRetriever = useMemo(
    () =>
      selection?.kind === "retriever"
        ? retrievers.find((r) => r.user_id === selection.id)
        : undefined,
    [selection, retrievers],
  );

  const flyTo = (lng: number, lat: number) =>
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 14, duration: 800 });

  async function rpc(fn: string, params: Record<string, unknown>, okMsg?: string) {
    const { error } = await supabase.rpc(fn, params);
    if (error) toast.error(error.message);
    else {
      if (okMsg) toast.success(okMsg);
      void reload();
    }
  }

  const availableRetrievers = retrievers.filter(
    (r) => r.availability === "available" && r.occupied_seats < r.vehicle_capacity,
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0b0c0d]">
      <MapView
        className={`absolute inset-y-0 right-0 h-full transition-[left] duration-300 ${rosterOpen ? "left-0 md:left-[380px]" : "left-0"}`}
        zones={zones}
        onReady={(map) => {
          mapRef.current = map;
          setMapReady(true);
        }}
      />

      {/* Overlay chrome — transparent to clicks except on real controls. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2 border-b border-white/8 bg-[#0b0c0d]/88 p-3 backdrop-blur-2xl">
          <Button asChild variant="secondary" size="icon" className="size-11 rounded-2xl shadow-lg">
            <Link to={`/events/${eventId}`} aria-label={m.ops.exitConsole}>
              <ArrowLeft className="size-5" />
            </Link>
          </Button>
          <div className="px-2 py-1">
            <div className="brand-kicker">OPERATIONS CONSOLE</div>
            <div className="text-sm font-semibold leading-tight">{event?.name ?? "…"}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FreshnessDot ageSec={live ? 0 : null} />
              {live ? m.ops.liveFeed : m.ops.reconnecting}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/8 px-3 py-2 text-xs font-semibold text-emerald-300 sm:flex">
              <Radio className="size-3.5" /> {live ? m.ops.liveFeed : m.ops.reconnecting}
            </div>
            <StatChip icon={<PlaneTakeoff className="size-4" />} value={pilots.length} label={m.ops.pilots} />
            <StatChip icon={<Car className="size-4" />} value={retrievers.length} label={m.ops.retrievers} />
            {emergencies.length > 0 && (
              <Button
                variant="destructive"
                className="h-11 gap-2 shadow-lg"
                onClick={() => setEmergencyOpen(true)}
              >
                <Siren className="size-4 animate-pulse" />
                {emergencies.length}
              </Button>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-start p-3">
          {rosterOpen ? (
            <div className="pointer-events-auto -ml-3 -mt-3 flex h-[calc(100vh-69px)] w-[380px] max-w-[92vw] flex-col border-r border-white/8 bg-[#111210]/98 shadow-2xl shadow-black/40 backdrop-blur-xl">
              <div className="border-b border-white/8 p-4">
                <div className="flex items-center gap-2">
                  <div>
                    <div className="brand-kicker">LIVE ROSTER</div>
                    <span className="text-lg font-semibold">{m.ops.console}</span>
                  </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-10 rounded-xl"
                  onClick={() => setRosterOpen(false)}
                  aria-label={m.common.close}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                </div>
                <div className="mt-4 flex h-11 items-center gap-2 rounded-xl border border-white/8 bg-white/[0.035] px-3 text-sm text-muted-foreground">
                  <Search className="size-4" />
                  <span>{m.ops.pilots} / {m.ops.retrievers}</span>
                </div>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-4 p-3">
                  <section className="space-y-2">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {m.ops.pilots}
                    </h3>
                    {pilots.length === 0 && (
                      <p className="text-sm text-muted-foreground">{m.ops.noPilots}</p>
                    )}
                    {pilots.map((p) => (
                      <PilotRow
                        key={p.task.id}
                        pilot={p}
                        active={selection?.kind === "pilot" && selection.id === p.task.id}
                        onClick={() => {
                          setSelection({ kind: "pilot", id: p.task.id });
                          if (p.fix) flyTo(p.fix.lng, p.fix.lat);
                        }}
                      />
                    ))}
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {m.ops.retrievers}
                    </h3>
                    {retrievers.length === 0 && (
                      <p className="text-sm text-muted-foreground">{m.ops.noRetrievers}</p>
                    )}
                    {retrievers.map((r) => (
                      <RetrieverRow
                        key={r.user_id}
                        retriever={r}
                        active={selection?.kind === "retriever" && selection.id === r.user_id}
                        onClick={() => {
                          setSelection({ kind: "retriever", id: r.user_id });
                          if (r.pos) flyTo(r.pos.lng, r.pos.lat);
                        }}
                      />
                    ))}
                  </section>
                </div>
              </ScrollArea>
            </div>
          ) : (
            <Button
              variant="secondary"
              className="pointer-events-auto h-11 shadow-lg"
              onClick={() => setRosterOpen(true)}
            >
              {m.ops.console}
            </Button>
          )}
        </div>
      </div>

      {/* Pilot telemetry drawer */}
      <Sheet open={!!selectedPilot} onOpenChange={(o) => !o && setSelection(null)}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          {selectedPilot && (
            <>
              <SheetHeader className="border-b">
                <SheetTitle className="flex flex-wrap items-center gap-2">
                  <FreshnessDot ageSec={ageSeconds(selectedPilot.fix?.recorded_at)} />
                  {selectedPilot.name}
                  <Badge variant={selectedPilot.task.status === "landed" ? "secondary" : "default"}>
                    {m.flights.statuses[selectedPilot.task.status]}
                  </Badge>
                </SheetTitle>
              </SheetHeader>
              <ScrollArea className="h-[calc(100dvh-4.5rem)]">
                <div className="space-y-4 p-4">
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                    <HeadingDial deg={selectedPilot.fix?.heading_deg} />
                    <BatteryGauge pct={selectedPilot.fix?.battery_pct} />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Stat label={m.ops.altitude} value={fmtAltitude(selectedPilot.fix?.altitude_m)} />
                    <Stat label={m.ops.speed} value={fmtSpeed(selectedPilot.fix?.speed_mps)} />
                    <Stat
                      label={m.ops.accuracy}
                      value={fmtAccuracy(selectedPilot.fix?.h_accuracy_m)}
                      tone={(selectedPilot.fix?.h_accuracy_m ?? 0) > 50 ? "warn" : "default"}
                    />
                    <Stat
                      label={m.ops.lastFix}
                      value={selectedPilot.fix ? fmtAgo(selectedPilot.fix.recorded_at, locale) : "—"}
                      tone={ageTone(ageSeconds(selectedPilot.fix?.recorded_at))}
                    />
                    <Stat
                      label={m.ops.flightTime}
                      value={fmtDuration(selectedPilot.task.started_at, selectedPilot.task.landed_at)}
                      sub={fmtDateTime(selectedPilot.task.started_at, locale)}
                    />
                    <Stat
                      label={m.ops.trackingState}
                      value={
                        selectedPilot.fix?.tracking_state
                          ? (m.ops.states[
                              selectedPilot.fix.tracking_state as keyof typeof m.ops.states
                            ] ?? selectedPilot.fix.tracking_state)
                          : "—"
                      }
                    />
                  </div>

                  <div className="rounded-lg border bg-card p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {m.ops.task}
                    </div>
                    <div className="text-sm">{selectedPilot.task.title}</div>
                  </div>

                  <div className="space-y-2 rounded-lg border bg-card p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {m.ops.activeJobs}
                    </div>
                    {selectedPilot.assignment ? (
                      <>
                        <div className="flex items-center gap-2 text-sm">
                          <Car className="size-4" />
                          {names[selectedPilot.assignment.retriever_id] ?? "?"}
                          <Badge variant="secondary" className="ml-auto">
                            {m.ops.assignment[selectedPilot.assignment.status as AssignmentStatus]}
                          </Badge>
                        </div>
                        {isOperator && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {nextAssignmentActions(selectedPilot.assignment.status).map((act) => (
                              <Button
                                key={act}
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  rpc("advance_assignment", {
                                    p_assignment: selectedPilot.assignment!.id,
                                    p_action: act,
                                  })
                                }
                              >
                                {m.ops.advance[act as keyof typeof m.ops.advance]}
                              </Button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : selectedPilot.task.status === "landed" && isOperator ? (
                      availableRetrievers.length > 0 ? (
                        <Select
                          onValueChange={(rid) =>
                            rpc(
                              "create_assignment",
                              { p_task: selectedPilot.task.id, p_retriever: rid },
                              m.ops.dispatch,
                            )
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={m.ops.dispatch} />
                          </SelectTrigger>
                          <SelectContent>
                            {availableRetrievers.map((r) => (
                              <SelectItem key={r.user_id} value={r.user_id}>
                                {r.name} · {r.vehicle_capacity - r.occupied_seats} {m.ops.seats}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-sm text-muted-foreground">{m.ops.noRetrievers}</p>
                      )
                    ) : (
                      <p className="text-sm text-muted-foreground">{m.common.none}</p>
                    )}
                  </div>

                  <Button asChild variant="outline" className="h-11 w-full">
                    <Link to={`/replay/${selectedPilot.task.id}`}>{m.flights.replay}</Link>
                  </Button>
                </div>
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Retriever drawer */}
      <Sheet open={!!selectedRetriever} onOpenChange={(o) => !o && setSelection(null)}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          {selectedRetriever && (
            <>
              <SheetHeader className="border-b">
                <SheetTitle className="flex flex-wrap items-center gap-2">
                  <FreshnessDot ageSec={ageSeconds(selectedRetriever.last_seen_at)} />
                  {selectedRetriever.name}
                  <Badge
                    variant={selectedRetriever.availability === "available" ? "default" : "secondary"}
                  >
                    {m.ops[selectedRetriever.availability]}
                  </Badge>
                </SheetTitle>
              </SheetHeader>
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-2 gap-2">
                  <Stat
                    label={m.ops.capacity}
                    value={`${selectedRetriever.occupied_seats}/${selectedRetriever.vehicle_capacity}`}
                    sub={`${selectedRetriever.vehicle_capacity - selectedRetriever.occupied_seats} ${m.ops.seats}`}
                  />
                  <Stat
                    label={m.ops.lastSeen}
                    value={
                      selectedRetriever.last_seen_at
                        ? fmtAgo(selectedRetriever.last_seen_at, locale)
                        : "—"
                    }
                    tone={ageTone(ageSeconds(selectedRetriever.last_seen_at))}
                  />
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {m.ops.vehicle}
                  </div>
                  <div className="text-sm">
                    {selectedRetriever.vehicle_description || m.common.none}
                  </div>
                </div>
                <div className="space-y-2 rounded-lg border bg-card p-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {m.ops.activeJobs}
                  </div>
                  {pilots.filter((p) => p.assignment?.retriever_id === selectedRetriever.user_id)
                    .length === 0 && (
                    <p className="text-sm text-muted-foreground">{m.common.none}</p>
                  )}
                  {pilots
                    .filter((p) => p.assignment?.retriever_id === selectedRetriever.user_id)
                    .map((p) => (
                      <button
                        key={p.task.id}
                        type="button"
                        className="flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left text-sm hover:bg-accent"
                        onClick={() => setSelection({ kind: "pilot", id: p.task.id })}
                      >
                        {p.name}
                        <Badge variant="secondary" className="ml-auto">
                          {m.ops.assignment[p.assignment!.status as AssignmentStatus]}
                        </Badge>
                      </button>
                    ))}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Emergency modal */}
      <Dialog open={emergencyOpen} onOpenChange={setEmergencyOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Siren className="size-5" />
              {m.ops.emergencies}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {emergencies.length === 0 && (
              <p className="text-sm text-muted-foreground">{m.ops.noEmergencies}</p>
            )}
            {emergencies.map((e) => (
              <div key={e.id} className="rounded-lg border border-destructive/40 p-3">
                <div className="font-medium">
                  {m.emergencies.raisedBy}: {names[e.user_id] ?? e.user_id.slice(0, 8)}
                </div>
                {e.message && <p className="text-sm text-muted-foreground">{e.message}</p>}
                <p className="text-xs text-muted-foreground">
                  {m.ops.raisedAt}: {fmtDateTime(e.created_at, locale)} ({fmtAgo(e.created_at, locale)})
                </p>
                {isOperator && (
                  <div className="mt-2 flex gap-2">
                    {e.status === "open" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          rpc("update_emergency", { p_emergency: e.id, p_action: "acknowledge" })
                        }
                      >
                        {m.ops.acknowledge}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        rpc("update_emergency", { p_emergency: e.id, p_action: "resolve" })
                      }
                    >
                      {m.ops.resolve}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ageTone(sec: number | null): "default" | "warn" | "danger" {
  if (sec == null) return "default";
  if (sec > 300) return "danger";
  if (sec > 60) return "warn";
  return "default";
}

function StatChip({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div
      className="flex h-11 items-center gap-2 rounded-lg bg-background/90 px-3 shadow-lg backdrop-blur"
      title={label}
    >
      {icon}
      <span className="font-mono text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/* ---------- map markers ---------- */

function el(html: string, onClick?: () => void): HTMLElement {
  const node = document.createElement("div");
  node.innerHTML = html;
  if (onClick) {
    node.style.cursor = "pointer";
    node.addEventListener("click", onClick);
  }
  return node;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function pilotMarker(p: PilotLive, onClick: () => void): HTMLElement {
  const color = p.task.status === "landed" ? "#d97706" : "#2563eb";
  const heading = p.fix?.heading_deg;
  const hasHeading = heading != null && Number.isFinite(heading);
  const low = (p.fix?.battery_pct ?? 100) <= 20;
  return el(
    `<div style="display:flex;flex-direction:column;align-items:center">
      <svg width="34" height="34" viewBox="0 0 40 40" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,.5))">
        ${
          hasHeading
            ? `<g transform="rotate(${heading} 20 20)"><path d="M20 3 L29 30 L20 24 L11 30 Z" fill="${color}" stroke="#fff" stroke-width="2.5"/></g>`
            : `<circle cx="20" cy="20" r="9" fill="${color}" stroke="#fff" stroke-width="3"/>`
        }
      </svg>
      <div style="margin-top:-2px;display:flex;align-items:center;gap:4px;background:rgba(255,255,255,.92);
        border-radius:4px;padding:1px 5px;font:600 11px/1.4 system-ui;white-space:nowrap;color:#111">
        ${esc(p.name)}
        ${p.fix?.altitude_m != null ? `<span style="font-family:ui-monospace,monospace;color:#555">${Math.round(p.fix.altitude_m)}m</span>` : ""}
        ${low ? `<span style="color:#dc2626">⚠</span>` : ""}
      </div>
    </div>`,
    onClick,
  );
}

function retrieverMarker(r: RetrieverLive, onClick: () => void): HTMLElement {
  const color = r.availability === "available" ? "#16a34a" : "#d97706";
  return el(
    `<div style="display:flex;flex-direction:column;align-items:center">
      <div style="width:16px;height:16px;border-radius:4px;background:${color};border:3px solid #fff;
        box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>
      <div style="margin-top:2px;background:rgba(255,255,255,.92);border-radius:4px;padding:1px 5px;
        font:600 11px/1.4 system-ui;white-space:nowrap;color:#111">
        ${esc(r.name)} <span style="font-family:ui-monospace,monospace;color:#555">${r.occupied_seats}/${r.vehicle_capacity}</span>
      </div>
    </div>`,
    onClick,
  );
}

function sosMarker(onClick: () => void): HTMLElement {
  return el(
    `<div style="width:20px;height:20px;border-radius:50%;background:#dc2626;border:3px solid #fff;
      box-shadow:0 0 0 6px rgba(220,38,38,.3)"></div>`,
    onClick,
  );
}
