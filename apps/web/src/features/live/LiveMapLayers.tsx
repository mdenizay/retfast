import { useEffect, useRef } from "react";
import { LngLatBounds, type MapLayerMouseEvent, type SymbolLayerSpecification } from "maplibre-gl";

type SymbolLayout = NonNullable<SymbolLayerSpecification["layout"]>;
import type { Feature, FeatureCollection } from "geojson";
import type { MapReady } from "@/components/map/MapCanvas";
import { EMPTY_FC, LABEL_FONT, circlePolygon, prefersReducedMotion, setGeoJSON, tokenColor } from "@/components/map/maplibre";
import { fmtAge } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Retrieval } from "@/lib/api/types";
import type { LivePilotView, RetrieverView } from "./store";
import { ICONS, LANDED_ICON, RETRIEVAL_ICONS, registerIcons, registerRetrievalIcons } from "./icons";
import { pilotPoint, secondsSince, statusSince } from "./derive";

export type MapSelection =
  | { kind: "pilot"; userId: string; flightId: string | null }
  | { kind: "retrieval"; id: string }
  | { kind: "retriever"; userId: string }
  | null;

interface Props extends MapReady {
  pilots: LivePilotView[];
  retrievals?: Retrieval[];
  retrievers?: RetrieverView[];
  /** Recorded track of the selected retriever ([lon, lat] pairs, oldest first). */
  retrieverTrack?: [number, number][];
  selection: MapSelection;
  follow: boolean;
  centerRequest: number;
  /** Point to center on when centerRequest changes (overrides the selected pilot). */
  centerOn?: { lat: number; lon: number } | null;
  fallbackCenter?: { lat: number; lon: number } | null;
  nowMs: number;
  clockOffsetMs?: number;
  onSelect: (sel: MapSelection) => void;
}

const SRC = {
  pilots: "rf-pilots",
  trails: "rf-trails",
  sel: "rf-sel-trail",
  acc: "rf-accuracy",
  lines: "rf-ret-lines",
  pins: "rf-ret-pins",
  ground: "rf-ret-ground",
  vehicles: "rf-retrievers",
  vtrack: "rf-retriever-track",
} as const;

const CLICKABLE = ["rf-pilots", "rf-ret-pins", "rf-ret-ground", "rf-retrievers"];

export function LiveMapLayers({
  map, styleVersion, pilots, retrievals = [], retrievers = [], retrieverTrack, selection, follow, centerRequest, centerOn, fallbackCenter,
  nowMs, clockOffsetMs = 0, onSelect,
}: Props) {
  const { t, lang } = useI18n();
  const fitted = useRef(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // (Re)create sources + layers on every style load.
  useEffect(() => {
    registerIcons(map);
    registerRetrievalIcons(map);
    const primary = tokenColor("primary", "#0C7469");
    const secondary = tokenColor("secondary", "#2B6894");
    const retrieval = tokenColor("retrieval", "#7440A8");
    const muted = tokenColor("text-muted", "#566A7B");
    const text = tokenColor("text-primary", "#101923");
    const halo = tokenColor("surface", "#ffffff");
    for (const id of Object.values(SRC)) setGeoJSON(map, id, EMPTY_FC);

    const add = (layer: Parameters<typeof map.addLayer>[0]) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer);
    };
    const label = {
      "text-field": ["get", "label"],
      "text-font": LABEL_FONT,
      "text-size": 12,
      "text-offset": [0, 1.5],
      "text-anchor": "top",
      "text-optional": true,
      "text-max-width": 14,
    } satisfies SymbolLayout;
    const labelPaint = { "text-color": text, "text-halo-color": halo, "text-halo-width": 1.5 };

    add({ id: "rf-trails-others", type: "line", source: SRC.trails, paint: { "line-color": muted, "line-width": 1.25, "line-opacity": 0.45 } });
    add({ id: "rf-accuracy-fill", type: "fill", source: SRC.acc, paint: { "fill-color": primary, "fill-opacity": 0.1 } });
    add({ id: "rf-accuracy-line", type: "line", source: SRC.acc, paint: { "line-color": primary, "line-width": 1, "line-dasharray": [2, 2] } });
    add({ id: "rf-sel-trail", type: "line", source: SRC.sel, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": primary, "line-width": 3 } });
    add({
      id: "rf-retriever-track", type: "line", source: SRC.vtrack, layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": secondary, "line-width": 3, "line-opacity": 0.75 },
    });
    // Retriever → pilot: dashed while approaching, solid once picked up.
    add({
      id: "rf-ret-lines", type: "line", source: SRC.lines, layout: { "line-cap": "round" },
      paint: { "line-color": secondary, "line-width": ["case", ["get", "selected"], 3, 2], "line-dasharray": [2, 1.5], "line-opacity": 0.9 },
    });
    add({
      id: "rf-selected-ring", type: "circle", source: SRC.pilots, filter: ["==", ["get", "selected"], true],
      paint: { "circle-radius": 22, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": primary, "circle-stroke-width": 2 },
    });
    add({
      id: "rf-pilots", type: "symbol", source: SRC.pilots,
      layout: {
        "icon-image": ["get", "icon"], "icon-rotate": ["get", "rotate"], "icon-rotation-alignment": "map",
        "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["get", "sort"], ...label,
      } as SymbolLayout,
      paint: labelPaint,
    });
    add({
      id: "rf-ret-ground", type: "symbol", source: SRC.ground,
      layout: { "icon-image": RETRIEVAL_ICONS.ground, "icon-allow-overlap": true, "icon-ignore-placement": true },
    });
    add({
      id: "rf-ret-pin-ring", type: "circle", source: SRC.pins, filter: ["==", ["get", "selected"], true],
      paint: { "circle-radius": 20, "circle-translate": [0, -12], "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": retrieval, "circle-stroke-width": 2 },
    });
    add({
      id: "rf-ret-pins", type: "symbol", source: SRC.pins,
      layout: {
        "icon-image": ["get", "icon"], "icon-anchor": "bottom", "icon-allow-overlap": true, "icon-ignore-placement": true,
        "symbol-sort-key": ["get", "sort"], ...label, "text-offset": [0, 0.4],
      } as SymbolLayout,
      paint: labelPaint,
    });
    add({
      id: "rf-retriever-ring", type: "circle", source: SRC.vehicles, filter: ["==", ["get", "selected"], true],
      paint: { "circle-radius": 22, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": secondary, "circle-stroke-width": 2 },
    });
    add({
      id: "rf-retrievers", type: "symbol", source: SRC.vehicles,
      layout: {
        "icon-image": ["get", "icon"], "icon-rotate": ["get", "rotate"], "icon-rotation-alignment": "map",
        "icon-allow-overlap": true, "icon-ignore-placement": true, ...label,
      } as SymbolLayout,
      paint: labelPaint,
    });

    const click = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const p = f?.properties as { kind?: string; id?: string; userId?: string } | undefined;
      if (!p?.kind || !p.id) return;
      if (p.kind === "pilot") onSelectRef.current({ kind: "pilot", userId: p.userId ?? p.id, flightId: p.id });
      else if (p.kind === "retrieval") onSelectRef.current({ kind: "retrieval", id: p.id });
      else if (p.kind === "retriever") onSelectRef.current({ kind: "retriever", userId: p.id });
    };
    const enter = () => (map.getCanvas().style.cursor = "pointer");
    const leave = () => (map.getCanvas().style.cursor = "");
    for (const l of CLICKABLE) {
      map.on("click", l, click);
      map.on("mouseenter", l, enter);
      map.on("mouseleave", l, leave);
    }
    return () => {
      for (const l of CLICKABLE) {
        map.off("click", l, click);
        map.off("mouseenter", l, enter);
        map.off("mouseleave", l, leave);
      }
    };
  }, [map, styleVersion]);

  // Selected retriever's recorded track, extended to the live position.
  const selRetrieverId = selection?.kind === "retriever" ? selection.userId : null;
  const selRetrieverPos = retrievers.find((r) => r.userId === selRetrieverId)?.position ?? null;
  const posLat = selRetrieverPos?.lat;
  const posLon = selRetrieverPos?.lon;
  useEffect(() => {
    const coords = selRetrieverId && retrieverTrack ? [...retrieverTrack] : [];
    if (coords.length && posLat !== undefined && posLon !== undefined) {
      const [lon, lat] = coords[coords.length - 1]!;
      if (lon !== posLon || lat !== posLat) coords.push([posLon, posLat]);
    }
    setGeoJSON(map, SRC.vtrack, coords.length >= 2
      ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} }] }
      : EMPTY_FC);
  }, [map, styleVersion, selRetrieverId, retrieverTrack, posLat, posLon]);

  const selFlight = selection?.kind === "pilot" ? selection.flightId : null;
  const selPilotUser = selection?.kind === "pilot" ? selection.userId : null;

  // Pilots with an open retrieval are drawn as pickup pin (+ ground position) instead of their landed flight fix.
  const openRetrievalPilots = new Set(
    retrievals.filter((r) => r.status === "requested" || r.status === "accepted" || r.status === "picked_up").map((r) => r.pilot.user_id),
  );
  const openKey = [...openRetrievalPilots].sort().join(",");

  // Pilot points.
  useEffect(() => {
    const hidden = new Set(openKey ? openKey.split(",") : []);
    const features: Feature[] = pilots.filter((p) => !(p.status !== "recording" && hidden.has(p.pilot?.user_id ?? ""))).map((p) => {
      const course = p.position.course_deg;
      const moving = course !== null && course !== undefined && (p.position.speed_ms ?? 1) > 0.5 && p.status === "recording";
      const icon = p.status === "recording" ? ICONS[p.freshness][moving ? "chevron" : "dot"] : LANDED_ICON;
      const parts = [p.pilot?.full_name || p.pilot?.public_id || "—"];
      if (p.isSimulated) parts.push("SIM");
      if (p.status === "ended") parts.push(t("live.landedShort"));
      else if (p.freshness === "stale") parts.push(`${t("fresh.stale")} ${fmtAge(p.ageS, lang)}`);
      else if (p.freshness === "lost") parts.push(`${t("fresh.lost")} ${fmtAge(p.ageS, lang)}`);
      const selected = p.flightId === selFlight || (selFlight === null && p.pilot?.user_id === selPilotUser);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.position.lon, p.position.lat] },
        properties: {
          kind: "pilot", id: p.flightId, userId: p.pilot?.user_id ?? p.flightId, icon, rotate: moving ? course : 0,
          label: parts.join(" · "), selected,
          sort: selected ? 1000 : p.freshness === "live" ? 3 : p.freshness === "stale" ? 2 : 1,
        },
      };
    });
    setGeoJSON(map, SRC.pilots, { type: "FeatureCollection", features });
  }, [map, styleVersion, pilots, selFlight, selPilotUser, openKey, t, lang]);

  // Retrieval pins, ground positions, retriever→pilot lines.
  const selRetrieval = selection?.kind === "retrieval" ? selection.id : null;
  useEffect(() => {
    const pins: Feature[] = [];
    const ground: Feature[] = [];
    const lines: Feature[] = [];
    for (const r of retrievals) {
      if (r.status !== "requested" && r.status !== "accepted" && r.status !== "picked_up") continue;
      const selected = r.id === selRetrieval || r.pilot.user_id === selPilotUser;
      const wait = secondsSince(statusSince(r), nowMs, clockOffsetMs);
      if (r.status !== "picked_up") {
        const label = `${r.pilot.full_name} · ${t(`retrieval.status.${r.status}`)}${wait !== null ? ` ${fmtAge(wait, lang)}` : ""}`;
        pins.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [r.pickup.lon, r.pickup.lat] },
          properties: {
            kind: "retrieval", id: r.id, label, selected,
            icon: r.status === "requested" ? RETRIEVAL_ICONS.pinRequested : RETRIEVAL_ICONS.pinAccepted,
            sort: selected ? 1000 : r.status === "requested" ? 10 : 5,
          },
        });
        if (r.pilot_position) {
          ground.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [r.pilot_position.lon, r.pilot_position.lat] },
            properties: { kind: "retrieval", id: r.id },
          });
        }
      }
      const rp = r.retriever_position ?? retrievers.find((x) => x.userId === r.retriever?.user_id)?.position ?? null;
      if (r.retriever && rp && r.status !== "picked_up") {
        const pp = pilotPoint(r);
        lines.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[rp.lon, rp.lat], [pp.lon, pp.lat]] },
          properties: { selected },
        });
      }
    }
    setGeoJSON(map, SRC.pins, { type: "FeatureCollection", features: pins });
    setGeoJSON(map, SRC.ground, { type: "FeatureCollection", features: ground });
    setGeoJSON(map, SRC.lines, { type: "FeatureCollection", features: lines });
  }, [map, styleVersion, retrievals, retrievers, selRetrieval, selPilotUser, nowMs, clockOffsetMs, t, lang]);

  // Retriever vehicles.
  const selRetriever = selection?.kind === "retriever" ? selection.userId : null;
  useEffect(() => {
    const features: Feature[] = [];
    for (const r of retrievers) {
      if (!r.position) continue;
      const f = r.freshness ?? "lost";
      const moving = r.position.course_deg != null && (r.position.speed_ms ?? 0) > 1;
      const parts = [r.fullName];
      if (f !== "live" && r.ageS !== null) parts.push(`${t(`fresh.${f}`)} ${fmtAge(r.ageS, lang)}`);
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.position.lon, r.position.lat] },
        properties: {
          kind: "retriever", id: r.userId, label: parts.join(" · "), selected: r.userId === selRetriever,
          icon: RETRIEVAL_ICONS.vehicle[f][moving ? "moving" : "still"], rotate: moving ? r.position.course_deg : 0,
        },
      });
    }
    setGeoJSON(map, SRC.vehicles, { type: "FeatureCollection", features });
  }, [map, styleVersion, retrievers, selRetriever, t, lang]);

  // Trails (throttled: heavier geometry).
  const lastTrailUpdate = useRef(0);
  const trailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const run = () => {
      lastTrailUpdate.current = Date.now();
      const others: FeatureCollection = {
        type: "FeatureCollection",
        features: pilots
          .filter((p) => p.flightId !== selFlight && p.trail.length > 1)
          .map((p) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: p.trail.map((q) => [q[0], q[1]]) } })),
      };
      setGeoJSON(map, SRC.trails, others);
    };
    const wait = 1000 - (Date.now() - lastTrailUpdate.current);
    if (trailTimer.current) clearTimeout(trailTimer.current);
    if (wait <= 0) run();
    else trailTimer.current = setTimeout(run, wait);
    return () => {
      if (trailTimer.current) clearTimeout(trailTimer.current);
    };
  }, [map, styleVersion, pilots, selFlight]);

  const selected = pilots.find((p) => p.flightId === selFlight) ?? null;

  // Selected trail + accuracy circle.
  useEffect(() => {
    if (!selected) {
      setGeoJSON(map, SRC.sel, EMPTY_FC);
      setGeoJSON(map, SRC.acc, EMPTY_FC);
      return;
    }
    setGeoJSON(map, SRC.sel, {
      type: "FeatureCollection",
      features: selected.trail.length > 1
        ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: selected.trail.map((q) => [q[0], q[1]]) } }]
        : [],
    });
    const acc = selected.position.h_acc_m;
    setGeoJSON(map, SRC.acc, {
      type: "FeatureCollection",
      features: acc && acc > 0 ? [{ type: "Feature", properties: {}, geometry: circlePolygon(selected.position.lon, selected.position.lat, acc) }] : [],
    });
  }, [map, styleVersion, selected]);

  // Initial framing: everything we can see (pilots, pickup points, retrievers).
  useEffect(() => {
    if (fitted.current) return;
    const pts: [number, number][] = [
      ...pilots.map((p) => [p.position.lon, p.position.lat] as [number, number]),
      ...retrievals.filter((r) => r.status === "requested" || r.status === "accepted").map((r) => [r.pickup.lon, r.pickup.lat] as [number, number]),
      ...retrievers.filter((r) => r.position).map((r) => [r.position!.lon, r.position!.lat] as [number, number]),
    ];
    if (pts.length > 0) {
      fitted.current = true;
      if (pts.length === 1) map.jumpTo({ center: pts[0]!, zoom: 12 });
      else {
        const b = new LngLatBounds();
        for (const p of pts) b.extend(p);
        map.fitBounds(b, { padding: 64, maxZoom: 13, animate: false });
      }
    } else if (fallbackCenter) {
      fitted.current = true;
      map.jumpTo({ center: [fallbackCenter.lon, fallbackCenter.lat], zoom: 11 });
    }
  }, [map, pilots, retrievals, retrievers, fallbackCenter]);

  // Follow / center.
  const selLon = selected?.position.lon;
  const selLat = selected?.position.lat;
  useEffect(() => {
    if (!follow || selLon === undefined || selLat === undefined) return;
    if (prefersReducedMotion()) map.jumpTo({ center: [selLon, selLat] });
    else map.easeTo({ center: [selLon, selLat], duration: 400 });
  }, [map, follow, selLon, selLat]);

  const lastCenter = useRef(centerRequest);
  const target = centerOn ?? (selLon !== undefined && selLat !== undefined ? { lon: selLon, lat: selLat } : null);
  const tLon = target?.lon;
  const tLat = target?.lat;
  useEffect(() => {
    if (centerRequest === lastCenter.current) return;
    lastCenter.current = centerRequest;
    if (tLon === undefined || tLat === undefined) return;
    const zoom = Math.max(map.getZoom(), 13);
    if (prefersReducedMotion()) map.jumpTo({ center: [tLon, tLat], zoom });
    else map.flyTo({ center: [tLon, tLat], zoom, duration: 600 });
  }, [map, centerRequest, tLon, tLat]);

  return null;
}
