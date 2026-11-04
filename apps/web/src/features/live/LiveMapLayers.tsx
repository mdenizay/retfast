import { useEffect, useRef } from "react";
import { LngLatBounds, type MapLayerMouseEvent } from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import type { MapReady } from "@/components/map/MapCanvas";
import { EMPTY_FC, LABEL_FONT, circlePolygon, prefersReducedMotion, setGeoJSON, tokenColor } from "@/components/map/maplibre";
import { fmtAge } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { LivePilotView } from "./store";
import { ICONS, registerIcons } from "./icons";

interface Props extends MapReady {
  pilots: LivePilotView[];
  selectedId: string | null;
  incidentFlightIds?: Set<string>;
  follow: boolean;
  centerRequest: number;
  fallbackCenter?: { lat: number; lon: number } | null;
  onSelect: (flightId: string | null) => void;
}

const SRC = { pilots: "rf-pilots", trails: "rf-trails", sel: "rf-sel-trail", acc: "rf-accuracy" } as const;

export function LiveMapLayers({ map, styleVersion, pilots, selectedId, incidentFlightIds, follow, centerRequest, fallbackCenter, onSelect }: Props) {
  const { t, lang } = useI18n();
  const fitted = useRef(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // (Re)create sources + layers on every style load.
  useEffect(() => {
    registerIcons(map);
    const primary = tokenColor("primary", "#0C7469");
    const muted = tokenColor("text-muted", "#566A7B");
    const text = tokenColor("text-primary", "#101923");
    const halo = tokenColor("surface", "#ffffff");
    const emergency = tokenColor("emergency", "#B3202C");
    for (const id of Object.values(SRC)) setGeoJSON(map, id, EMPTY_FC);

    const add = (layer: Parameters<typeof map.addLayer>[0]) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer);
    };
    add({ id: "rf-trails-others", type: "line", source: SRC.trails, paint: { "line-color": muted, "line-width": 1.25, "line-opacity": 0.45 } });
    add({ id: "rf-accuracy-fill", type: "fill", source: SRC.acc, paint: { "fill-color": primary, "fill-opacity": 0.1 } });
    add({ id: "rf-accuracy-line", type: "line", source: SRC.acc, paint: { "line-color": primary, "line-width": 1, "line-dasharray": [2, 2] } });
    add({ id: "rf-sel-trail", type: "line", source: SRC.sel, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": primary, "line-width": 3 } });
    add({
      id: "rf-incident-ring", type: "circle", source: SRC.pilots, filter: ["==", ["get", "incident"], true],
      paint: { "circle-radius": 20, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": emergency, "circle-stroke-width": 3 },
    });
    add({
      id: "rf-selected-ring", type: "circle", source: SRC.pilots, filter: ["==", ["get", "selected"], true],
      paint: { "circle-radius": 22, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": primary, "circle-stroke-width": 2 },
    });
    add({
      id: "rf-pilots", type: "symbol", source: SRC.pilots,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-rotate": ["get", "rotate"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "symbol-sort-key": ["get", "sort"],
        "text-field": ["get", "label"],
        "text-font": LABEL_FONT,
        "text-size": 12,
        "text-offset": [0, 1.5],
        "text-anchor": "top",
        "text-optional": true,
        "text-max-width": 14,
      },
      paint: { "text-color": text, "text-halo-color": halo, "text-halo-width": 1.5 },
    });

    const click = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) onSelectRef.current(id);
    };
    const enter = () => (map.getCanvas().style.cursor = "pointer");
    const leave = () => (map.getCanvas().style.cursor = "");
    map.on("click", "rf-pilots", click);
    map.on("mouseenter", "rf-pilots", enter);
    map.on("mouseleave", "rf-pilots", leave);
    return () => {
      map.off("click", "rf-pilots", click);
      map.off("mouseenter", "rf-pilots", enter);
      map.off("mouseleave", "rf-pilots", leave);
    };
  }, [map, styleVersion]);

  // Pilot points (cheap; every frame/tick is fine for thousands of points).
  useEffect(() => {
    const features: Feature[] = pilots.map((p) => {
      const course = p.position.course_deg;
      const moving = course !== null && course !== undefined && (p.position.speed_ms ?? 1) > 0.5;
      const icon = ICONS[p.freshness][moving ? "chevron" : "dot"];
      const parts = [p.pilot?.full_name || p.pilot?.public_id || "—"];
      if (p.isSimulated) parts.push("SIM");
      if (p.freshness === "stale") parts.push(`${t("fresh.stale")} ${fmtAge(p.ageS, lang)}`);
      if (p.freshness === "lost") parts.push(`${t("fresh.lost")} ${fmtAge(p.ageS, lang)}`);
      const selected = p.flightId === selectedId;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.position.lon, p.position.lat] },
        properties: {
          id: p.flightId, icon, rotate: moving ? course : 0, label: parts.join(" · "), selected,
          incident: Boolean(incidentFlightIds?.has(p.flightId)),
          sort: selected ? 1000 : p.freshness === "live" ? 3 : p.freshness === "stale" ? 2 : 1,
        },
      };
    });
    setGeoJSON(map, SRC.pilots, { type: "FeatureCollection", features });
  }, [map, styleVersion, pilots, selectedId, incidentFlightIds, t, lang]);

  // Trails (throttled: heavier geometry).
  const lastTrailUpdate = useRef(0);
  const trailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const run = () => {
      lastTrailUpdate.current = Date.now();
      const others: FeatureCollection = {
        type: "FeatureCollection",
        features: pilots
          .filter((p) => p.flightId !== selectedId && p.trail.length > 1)
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
  }, [map, styleVersion, pilots, selectedId]);

  const selected = pilots.find((p) => p.flightId === selectedId) ?? null;

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

  // Initial framing.
  useEffect(() => {
    if (fitted.current) return;
    if (pilots.length > 0) {
      fitted.current = true;
      if (pilots.length === 1) {
        map.jumpTo({ center: [pilots[0]!.position.lon, pilots[0]!.position.lat], zoom: 12 });
      } else {
        const b = new LngLatBounds();
        for (const p of pilots) b.extend([p.position.lon, p.position.lat]);
        map.fitBounds(b, { padding: 64, maxZoom: 13, animate: false });
      }
    } else if (fallbackCenter) {
      fitted.current = true;
      map.jumpTo({ center: [fallbackCenter.lon, fallbackCenter.lat], zoom: 11 });
    }
  }, [map, pilots, fallbackCenter]);

  // Follow / center.
  const selLon = selected?.position.lon;
  const selLat = selected?.position.lat;
  useEffect(() => {
    if (!follow || selLon === undefined || selLat === undefined) return;
    if (prefersReducedMotion()) map.jumpTo({ center: [selLon, selLat] });
    else map.easeTo({ center: [selLon, selLat], duration: 400 });
  }, [map, follow, selLon, selLat]);

  const lastCenter = useRef(centerRequest);
  useEffect(() => {
    if (centerRequest === lastCenter.current) return;
    lastCenter.current = centerRequest;
    if (selLon === undefined || selLat === undefined) return;
    const zoom = Math.max(map.getZoom(), 13);
    if (prefersReducedMotion()) map.jumpTo({ center: [selLon, selLat], zoom });
    else map.flyTo({ center: [selLon, selLat], zoom, duration: 600 });
  }, [map, centerRequest, selLon, selLat]);

  return null;
}
