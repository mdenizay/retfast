import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap } from "maplibre-gl";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import MapView from "@/components/MapView";
import { useI18n } from "@/i18n";
import { fmtAltitude, fmtDistance, fmtSpeed, fmtTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { TaskTrack } from "@/lib/types";
import { ArrowLeft, Pause, Play } from "lucide-react";

const SPEEDS = [1, 4, 16, 64];

export default function ReplayPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { m, locale } = useI18n();
  const [track, setTrack] = useState<TaskTrack | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(16);
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<MLMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!taskId) return;
    void supabase.rpc("task_track", { p_task: taskId }).then(({ data }) => {
      setTrack((data as TaskTrack | null) ?? null);
    });
  }, [taskId]);

  const points = useMemo(() => track?.points ?? [], [track]);

  // Playback clock: advance index proportional to recorded time.
  useEffect(() => {
    if (!playing || points.length < 2) return;
    const timer = setInterval(() => {
      setIdx((i) => {
        if (i >= points.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, Math.max(30, 30000 / speed)); // seed tracks are ~30 s apart
    return () => clearInterval(timer);
  }, [playing, speed, points]);

  // Draw the trail + moving marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || points.length === 0) return;

    const upTo = points.slice(0, idx + 1);
    const line: GeoJSON.Feature = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: upTo.map((p) => [p.lng, p.lat]) },
      properties: {},
    };
    const full: GeoJSON.Feature = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) },
      properties: {},
    };

    const ensure = (id: string, data: GeoJSON.Feature, paint: Record<string, unknown>) => {
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(data);
      else {
        map.addSource(id, { type: "geojson", data });
        map.addLayer({ id, type: "line", source: id, paint: paint as never });
      }
    };
    ensure("replay-full", full, { "line-color": "#94a3b8", "line-width": 2, "line-dasharray": [2, 2] });
    ensure("replay-trail", line, { "line-color": "#2563eb", "line-width": 3 });

    const cur = points[idx];
    if (!markerRef.current) {
      const el = document.createElement("div");
      el.innerHTML = `<div style="width:14px;height:14px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`;
      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([cur.lng, cur.lat])
        .addTo(map);
    } else {
      markerRef.current.setLngLat([cur.lng, cur.lat]);
    }
  }, [idx, points, mapReady]);

  // Fit the camera once both the map and the track are available.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || points.length === 0) return;
    const bounds = points.reduce(
      (b, p) => b.extend([p.lng, p.lat]),
      new maplibregl.LngLatBounds([points[0].lng, points[0].lat], [points[0].lng, points[0].lat]),
    );
    map.fitBounds(bounds, { padding: 60 });
  }, [mapReady, points]);

  const cur = points[idx];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to={track ? `/events/${track.task.event_id}?tab=flights` : "/events"}>
            <ArrowLeft className="size-4" />
            {m.common.back}
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">
          {m.replay.title}
          {track ? ` — ${track.task.title}` : ""}
        </h1>
        {track && (
          <div className="ml-auto flex gap-4 text-sm text-muted-foreground">
            <span>
              {m.flights.distance}: <b>{fmtDistance(track.stats.distance_m)}</b>
            </span>
            <span>
              {m.flights.maxAltitude}: <b>{fmtAltitude(track.stats.max_altitude_m)}</b>
            </span>
            <span>
              {m.flights.maxSpeed}: <b>{fmtSpeed(track.stats.max_speed_mps)}</b>
            </span>
            <span>
              {m.flights.points}: <b>{track.stats.point_count}</b>
            </span>
          </div>
        )}
      </div>

      <MapView
        className="h-[520px] w-full rounded-md border"
        center={points.length ? [points[0].lng, points[0].lat] : undefined}
        zoom={12}
        onReady={(map) => {
          mapRef.current = map;
          setMapReady(true);
        }}
      />

      <div className="flex items-center gap-4 rounded-md border p-3">
        <Button
          size="icon"
          variant="outline"
          disabled={points.length < 2}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <Slider
          className="flex-1"
          min={0}
          max={Math.max(0, points.length - 1)}
          step={1}
          value={[idx]}
          onValueChange={([v]) => setIdx(v)}
        />
        <div className="w-40 text-right text-sm tabular-nums text-muted-foreground">
          {cur ? fmtTime(cur.recorded_at, locale) : "—"}
          {cur && (
            <div className="text-xs">
              {fmtAltitude(cur.altitude_m)} · {fmtSpeed(cur.speed_mps)}
            </div>
          )}
        </div>
        <div className="flex gap-1">
          {SPEEDS.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={s === speed ? "default" : "ghost"}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
