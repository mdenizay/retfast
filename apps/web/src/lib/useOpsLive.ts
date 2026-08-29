import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { parseWkbPoint } from "@/lib/geo";
import { supabase } from "@/lib/supabase";
import type {
  EmergencyEvent,
  EventRow,
  GeoZone,
  RetrievalAssignment,
  RetrieverProfile,
  Task,
} from "@/lib/types";

/** Latest telemetry sample for one actor. */
export interface Fix {
  lat: number;
  lng: number;
  altitude_m: number | null;
  speed_mps: number | null;
  heading_deg: number | null;
  battery_pct: number | null;
  h_accuracy_m: number | null;
  tracking_state: string | null;
  recorded_at: string;
}

export interface PilotLive {
  task: Task;
  name: string;
  fix: Fix | null;
  assignment: RetrievalAssignment | null;
}

export interface RetrieverLive extends RetrieverProfile {
  name: string;
  pos: { lat: number; lng: number } | null;
}

/**
 * Single source of live operational state for the ops surfaces.
 *
 * Realtime events trigger a refetch; a 15 s timer is the fallback so the
 * picture still converges if the socket is down (see docs/realtime.md).
 */
export function useOpsLive(eventId: string | undefined) {
  const { profile, session } = useAuth();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [zones, setZones] = useState<GeoZone[]>([]);
  const [pilots, setPilots] = useState<PilotLive[]>([]);
  const [retrievers, setRetrievers] = useState<RetrieverLive[]>([]);
  const [emergencies, setEmergencies] = useState<EmergencyEvent[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [isOperator, setIsOperator] = useState(false);
  const [live, setLive] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    if (!eventId || !session || inFlight.current) return;
    inFlight.current = true;
    try {
      const [evRes, zoneRes, taskRes, retRes, asgRes, emRes, memRes] = await Promise.all([
        supabase.from("events").select("*").eq("id", eventId).maybeSingle(),
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
          .select("user_id, role, profile:profiles!event_members_user_id_fkey(id, display_name)")
          .eq("event_id", eventId),
      ]);

      setEvent((evRes.data as EventRow | null) ?? null);
      setZones((zoneRes.data as GeoZone[]) ?? []);
      setEmergencies((emRes.data as EmergencyEvent[]) ?? []);

      const nameMap: Record<string, string> = {};
      let operator = !!profile?.is_system_admin;
      for (const row of (memRes.data ?? []) as unknown as {
        user_id: string;
        role: string;
        profile: { display_name: string } | null;
      }[]) {
        if (row.profile) nameMap[row.user_id] = row.profile.display_name;
        if (
          row.user_id === session.user.id &&
          (row.role === "observer" || row.role === "event_admin")
        ) {
          operator = true;
        }
      }
      setNames(nameMap);
      setIsOperator(operator);

      const assignments = (asgRes.data as RetrievalAssignment[]) ?? [];
      const tasks = (taskRes.data as Task[]) ?? [];

      // Newest fix per open task, carrying the full telemetry payload.
      const fixes: Record<string, Fix> = {};
      if (tasks.length) {
        const { data: pts } = await supabase
          .from("location_points")
          .select(
            "task_id, geom, altitude_m, speed_mps, heading_deg, battery_pct, h_accuracy_m, tracking_state, recorded_at",
          )
          .in(
            "task_id",
            tasks.map((t) => t.id),
          )
          .order("recorded_at", { ascending: false })
          .limit(600);
        for (const p of (pts ?? []) as unknown as (Fix & { task_id: string; geom: unknown })[]) {
          if (fixes[p.task_id]) continue;
          const pos = parseWkbPoint(p.geom);
          if (!pos) continue;
          fixes[p.task_id] = {
            lat: pos.lat,
            lng: pos.lng,
            altitude_m: p.altitude_m,
            speed_mps: p.speed_mps,
            heading_deg: p.heading_deg,
            battery_pct: p.battery_pct,
            h_accuracy_m: p.h_accuracy_m,
            tracking_state: p.tracking_state,
            recorded_at: p.recorded_at,
          };
        }
      }

      setPilots(
        tasks.map((task) => ({
          task,
          name: nameMap[task.pilot_id] ?? task.pilot_id.slice(0, 8),
          fix: fixes[task.id] ?? null,
          assignment: assignments.find((a) => a.task_id === task.id) ?? null,
        })),
      );

      setRetrievers(
        (((retRes.data as unknown as (RetrieverProfile & { last_geom: unknown })[]) ?? []).map(
          (r) => ({
            ...r,
            name: nameMap[r.user_id] ?? r.user_id.slice(0, 8),
            pos: parseWkbPoint(r.last_geom),
          }),
        ) as RetrieverLive[]),
      );
      setLoaded(true);
    } finally {
      inFlight.current = false;
    }
  }, [eventId, session, profile]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 15000);
    return () => clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    if (!eventId) return;
    const channel = supabase.channel(`ops:${eventId}`);
    for (const table of [
      "location_points",
      "tasks",
      "retriever_profiles",
      "retrieval_requests",
      "retrieval_assignments",
      "emergency_events",
    ]) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `event_id=eq.${eventId}` },
        () => void reload(),
      );
    }
    channel.subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [eventId, reload]);

  return { event, zones, pilots, retrievers, emergencies, names, isOperator, live, loaded, reload };
}

/** Valid next transitions for a retrieval assignment. */
export function nextAssignmentActions(status: string): string[] {
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
