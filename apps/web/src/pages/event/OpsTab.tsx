import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap } from "maplibre-gl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import MapView from "@/components/MapView";
import { useI18n } from "@/i18n";
import { fmtAgo, fmtAltitude, fmtSpeed } from "@/lib/format";
import { parseWkbPoint } from "@/lib/geo";
import { supabase } from "@/lib/supabase";
import type {
  AssignmentStatus,
  EmergencyEvent,
  GeoZone,
  RetrievalAssignment,
  RetrieverProfile,
  Task,
} from "@/lib/types";
import { Siren } from "lucide-react";

interface LivePosition {
  lng: number;
  lat: number;
  altitude_m: number | null;
  speed_mps: number | null;
  battery_pct: number | null;
  recorded_at: string;
}

interface RetrieverRow extends RetrieverProfile {
  pos: { lng: number; lat: number } | null;
}

export default function OpsTab({ eventId, isOperator }: { eventId: string; isOperator: boolean }) {
  const { m, locale } = useI18n();
  const [zones, setZones] = useState<GeoZone[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [retrievers, setRetrievers] = useState<RetrieverRow[]>([]);
  const [assignments, setAssignments] = useState<RetrievalAssignment[]>([]);
  const [emergencies, setEmergencies] = useState<EmergencyEvent[]>([]);
  const [positions, setPositions] = useState<Record<string, LivePosition>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  const loadState = useCallback(async () => {
    const [zonesRes, tasksRes, retRes, asgRes, emRes, memRes] = await Promise.all([
      supabase.from("geo_zones").select("*").eq("event_id", eventId),
      supabase
        .from("tasks")
        .select("*")
        .eq("event_id", eventId)
        .in("status", ["active", "landed"]),
      supabase.from("retriever_profiles").select("*").eq("event_id", eventId),
      supabase
        .from("retrieval_assignments")
        .select("*")
        .eq("event_id", eventId)
        .in("status", ["assigned", "en_route", "picked_up"]),
      supabase
        .from("emergency_events")
        .select("*")
        .eq("event_id", eventId)
        .in("status", ["open", "acknowledged"])
        .order("created_at", { ascending: false }),
      supabase
        .from("event_members")
        .select("user_id, profile:profiles!event_members_user_id_fkey(id, display_name)")
        .eq("event_id", eventId),
    ]);
    setZones((zonesRes.data as GeoZone[]) ?? []);
    setTasks((tasksRes.data as Task[]) ?? []);
    setAssignments((asgRes.data as RetrievalAssignment[]) ?? []);
    setEmergencies((emRes.data as EmergencyEvent[]) ?? []);
    const nameMap: Record<string, string> = {};
    for (const row of (memRes.data ?? []) as unknown as {
      user_id: string;
      profile: { display_name: string } | null;
    }[]) {
      if (row.profile) nameMap[row.user_id] = row.profile.display_name;
    }
    setNames(nameMap);
    setRetrievers(
      (((retRes.data as unknown as (RetrieverProfile & { last_geom: unknown })[]) ?? []).map(
        (r) => ({ ...r, pos: parseWkbPoint(r.last_geom) }),
      ) as RetrieverRow[]),
    );

    // Latest known point for each open task.
    const openTasks = ((tasksRes.data as Task[]) ?? []).map((t) => t.id);
    if (openTasks.length) {
      const { data: pts } = await supabase
        .from("location_points")
        .select("task_id, geom, altitude_m, speed_mps, battery_pct, recorded_at")
        .in("task_id", openTasks)
        .order("recorded_at", { ascending: false })
        .limit(400);
      const latest: Record<string, LivePosition> = {};
      for (const p of (pts ?? []) as unknown as {
        task_id: string;
        geom: unknown;
        altitude_m: number | null;
        speed_mps: number | null;
        battery_pct: number | null;
        recorded_at: string;
      }[]) {
        if (latest[p.task_id]) continue;
        const pos = parseWkbPoint(p.geom);
        if (pos)
          latest[p.task_id] = {
            ...pos,
            altitude_m: p.altitude_m,
            speed_mps: p.speed_mps,
            battery_pct: p.battery_pct,
            recorded_at: p.recorded_at,
          };
      }
      setPositions(latest);
    } else {
      setPositions({});
    }
  }, [eventId]);

  useEffect(() => {
    void loadState();
    // Polling fallback: keeps the ops picture fresh even if the Realtime
    // socket is down; Realtime events just make it instant.
    const timer = setInterval(() => void loadState(), 15000);
    return () => clearInterval(timer);
  }, [loadState]);

  // Realtime: point inserts update positions in place; any state-table change
  // triggers a cheap refetch (idempotent, converges after reconnects).
  useEffect(() => {
    const channel = supabase
      .channel(`ops:${eventId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "location_points", filter: `event_id=eq.${eventId}` },
        (payload) => {
          const row = payload.new as {
            task_id: string | null;
            user_id: string;
            geom: unknown;
            altitude_m: number | null;
            speed_mps: number | null;
            battery_pct: number | null;
            recorded_at: string;
          };
          const pos = parseWkbPoint(row.geom);
          if (!pos) return;
          if (row.task_id) {
            setPositions((prev) => {
              const cur = prev[row.task_id!];
              if (cur && cur.recorded_at > row.recorded_at) return prev;
              return {
                ...prev,
                [row.task_id!]: {
                  ...pos,
                  altitude_m: row.altitude_m,
                  speed_mps: row.speed_mps,
                  battery_pct: row.battery_pct,
                  recorded_at: row.recorded_at,
                },
              };
            });
          } else {
            setRetrievers((prev) =>
              prev.map((r) =>
                r.user_id === row.user_id
                  ? { ...r, pos, last_seen_at: row.recorded_at }
                  : r,
              ),
            );
          }
        },
      );
    for (const table of [
      "tasks",
      "retriever_profiles",
      "retrieval_requests",
      "retrieval_assignments",
      "emergency_events",
    ]) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `event_id=eq.${eventId}` },
        () => void loadState(),
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [eventId, loadState]);

  // Sync markers with the map imperatively.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const keep = new Set<string>();

    const upsert = (key: string, lng: number, lat: number, el: () => HTMLElement) => {
      keep.add(key);
      const existing = markers.get(key);
      if (existing) {
        existing.setLngLat([lng, lat]);
      } else {
        const marker = new maplibregl.Marker({ element: el() }).setLngLat([lng, lat]).addTo(map);
        markers.set(key, marker);
      }
    };

    for (const t of tasks) {
      const p = positions[t.id];
      if (!p) continue;
      upsert(`task:${t.id}`, p.lng, p.lat, () =>
        makeMarker(t.status === "landed" ? "#d97706" : "#2563eb", names[t.pilot_id] ?? "pilot"),
      );
    }
    for (const r of retrievers) {
      if (!r.pos || r.availability === "offline") continue;
      upsert(`ret:${r.user_id}`, r.pos.lng, r.pos.lat, () =>
        makeMarker("#16a34a", names[r.user_id] ?? "retriever", true),
      );
    }
    for (const e of emergencies) {
      const pos = parseWkbPoint(e.geom as unknown);
      if (!pos) continue;
      upsert(`sos:${e.id}`, pos.lng, pos.lat, () => makeSosMarker());
    }

    for (const [key, marker] of markers) {
      if (!keep.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    }
  }, [tasks, retrievers, emergencies, positions, names, mapReady]);

  async function updateEmergency(id: string, action: "acknowledge" | "resolve") {
    const { error } = await supabase.rpc("update_emergency", { p_emergency: id, p_action: action });
    if (error) toast.error(error.message);
  }

  async function dispatch(taskId: string, retrieverId: string) {
    const { error } = await supabase.rpc("create_assignment", {
      p_task: taskId,
      p_retriever: retrieverId,
    });
    if (error) toast.error(error.message);
  }

  async function advance(assignmentId: string, action: string) {
    const { error } = await supabase.rpc("advance_assignment", {
      p_assignment: assignmentId,
      p_action: action,
    });
    if (error) toast.error(error.message);
  }

  const assignedTaskIds = new Set(assignments.map((a) => a.task_id));
  const needsRetriever = tasks.filter((t) => t.status === "landed" && !assignedTaskIds.has(t.id));
  const availableRetrievers = retrievers.filter(
    (r) => r.availability === "available" && r.occupied_seats < r.vehicle_capacity,
  );

  return (
    <div className="space-y-4">
      {emergencies.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-destructive">
          <Siren className="size-4 animate-pulse" />
          <span className="text-sm font-semibold">
            {m.emergencies.banner} — {emergencies.length}
          </span>
        </div>
      )}
      <MapView
        className="h-[440px] w-full rounded-md border"
        zones={zones}
        onReady={(map) => {
          mapRef.current = map;
          setMapReady(true);
        }}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Emergencies */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{m.ops.emergencies}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {emergencies.length === 0 && (
              <p className="text-sm text-muted-foreground">{m.ops.noEmergencies}</p>
            )}
            {emergencies.map((e) => (
              <div key={e.id} className="rounded-md border border-destructive/40 p-3">
                <p className="text-sm font-medium">
                  {m.emergencies.raisedBy}: {names[e.user_id] ?? e.user_id.slice(0, 8)}
                </p>
                {e.message && <p className="text-sm text-muted-foreground">{e.message}</p>}
                <p className="text-xs text-muted-foreground">{fmtAgo(e.created_at, locale)}</p>
                {isOperator && (
                  <div className="mt-2 flex gap-2">
                    {e.status === "open" && (
                      <Button size="sm" variant="outline" onClick={() => updateEmergency(e.id, "acknowledge")}>
                        {m.ops.acknowledge}
                      </Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => updateEmergency(e.id, "resolve")}>
                      {m.ops.resolve}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Landed pilots needing retrieval */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{m.ops.needsRetriever}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {needsRetriever.length === 0 && (
              <p className="text-sm text-muted-foreground">{m.common.none}</p>
            )}
            {needsRetriever.map((t) => (
              <div key={t.id} className="rounded-md border p-3">
                <p className="text-sm font-medium">{names[t.pilot_id] ?? t.pilot_id.slice(0, 8)}</p>
                <p className="text-xs text-muted-foreground">
                  {t.title} · {fmtAgo(t.landed_at, locale)}
                </p>
                {isOperator && availableRetrievers.length > 0 && (
                  <div className="mt-2">
                    <Select onValueChange={(rid) => dispatch(t.id, rid)}>
                      <SelectTrigger className="w-full" size="sm">
                        <SelectValue placeholder={m.ops.dispatch} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableRetrievers.map((r) => (
                          <SelectItem key={r.user_id} value={r.user_id}>
                            {names[r.user_id] ?? r.user_id.slice(0, 8)} (
                            {r.vehicle_capacity - r.occupied_seats})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Retrievers + active jobs */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{m.ops.retrievers}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {retrievers.map((r) => (
              <div key={r.user_id} className="flex items-center gap-2 text-sm">
                <span
                  className={`inline-block size-2 rounded-full ${
                    r.availability === "available"
                      ? "bg-green-500"
                      : r.availability === "busy"
                        ? "bg-amber-500"
                        : "bg-gray-400"
                  }`}
                />
                <span className="font-medium">{names[r.user_id] ?? r.user_id.slice(0, 8)}</span>
                <span className="text-muted-foreground">
                  {r.occupied_seats}/{r.vehicle_capacity}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {r.last_seen_at ? fmtAgo(r.last_seen_at, locale) : m.ops.noSignal}
                </span>
              </div>
            ))}
            {assignments.length > 0 && (
              <>
                <p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {m.ops.activeJobs}
                </p>
                {assignments.map((a) => (
                  <div key={a.id} className="rounded-md border p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span>{names[a.pilot_id] ?? "?"}</span>
                      <span className="text-muted-foreground">→</span>
                      <span>{names[a.retriever_id] ?? "?"}</span>
                      <Badge variant="secondary" className="ml-auto">
                        {m.ops.assignment[a.status as AssignmentStatus]}
                      </Badge>
                    </div>
                    {isOperator && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {nextActions(a.status as AssignmentStatus).map((act) => (
                          <Button
                            key={act}
                            size="sm"
                            variant="outline"
                            onClick={() => advance(a.id, act)}
                          >
                            {m.ops.advance[act as keyof typeof m.ops.advance]}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pilot status strip */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {tasks.map((t) => {
          const p = positions[t.id];
          return (
            <div key={t.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <span
                className={`inline-block size-2 rounded-full ${
                  t.status === "landed" ? "bg-amber-500" : "bg-blue-500"
                }`}
              />
              <span className="font-medium">{names[t.pilot_id] ?? t.pilot_id.slice(0, 8)}</span>
              <span className="text-muted-foreground">
                {m.flights.statuses[t.status as "active" | "landed"]}
              </span>
              {p ? (
                <span className="ml-auto text-xs text-muted-foreground">
                  {fmtAltitude(p.altitude_m)} · {fmtSpeed(p.speed_mps)} ·{" "}
                  {p.battery_pct != null ? `${p.battery_pct}%` : "—"} ·{" "}
                  {fmtAgo(p.recorded_at, locale)}
                </span>
              ) : (
                <span className="ml-auto text-xs text-muted-foreground">{m.ops.noSignal}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function nextActions(status: AssignmentStatus): string[] {
  switch (status) {
    case "assigned":
      return ["en_route", "picked_up", "cancel"];
    case "en_route":
      return ["picked_up", "cancel"];
    case "picked_up":
      return ["delivered", "cancel"];
    case "delivered":
      return ["completed"];
    default:
      return [];
  }
}

function makeMarker(color: string, label: string, square = false): HTMLElement {
  const el = document.createElement("div");
  el.className = "flex flex-col items-center";
  el.innerHTML = `
    <div style="background:${color};width:14px;height:14px;border:2px solid #fff;
      border-radius:${square ? "3px" : "50%"};box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>
    <div style="font-size:10px;font-weight:600;color:#111;background:rgba(255,255,255,.85);
      padding:0 4px;border-radius:3px;margin-top:2px;white-space:nowrap">${escapeHtml(label)}</div>`;
  return el;
}

function makeSosMarker(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `<div style="width:18px;height:18px;border-radius:50%;background:#dc2626;
    border:3px solid #fff;box-shadow:0 0 0 4px rgba(220,38,38,.35);animation:pulse 1s infinite"></div>`;
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
