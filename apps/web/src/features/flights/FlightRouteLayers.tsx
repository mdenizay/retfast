import { useEffect } from "react";
import { LngLatBounds } from "maplibre-gl";
import type { MapReady } from "@/components/map/MapCanvas";
import { setGeoJSON, tokenColor } from "@/components/map/maplibre";
import type { Position } from "@/lib/api/types";
import { POOR_FIX_M } from "./quality";

export function FlightRouteLayers({ map, styleVersion, positions }: MapReady & { positions: Position[] }) {
  useEffect(() => {
    const primary = tokenColor("primary", "#0C7469");
    const halo = tokenColor("surface", "#ffffff");
    const warn = tokenColor("warning", "#8F5500");
    const coords = positions.map((p) => [p.lon, p.lat]);
    setGeoJSON(map, "rf-route", {
      type: "FeatureCollection",
      features: coords.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] : [],
    });
    const first = positions[0];
    const last = positions[positions.length - 1];
    setGeoJSON(map, "rf-route-ends", {
      type: "FeatureCollection",
      features: [first, last].filter(Boolean).map((p, i) => ({
        type: "Feature", properties: { kind: i === 0 ? "start" : "end" }, geometry: { type: "Point", coordinates: [p!.lon, p!.lat] },
      })),
    });
    setGeoJSON(map, "rf-route-poor", {
      type: "FeatureCollection",
      features: positions.filter((p) => (p.h_acc_m ?? 0) > POOR_FIX_M).map((p) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.lon, p.lat] } })),
    });
    if (!map.getLayer("rf-route")) {
      map.addLayer({ id: "rf-route-casing", type: "line", source: "rf-route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": halo, "line-width": 5 } });
      map.addLayer({ id: "rf-route", type: "line", source: "rf-route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": primary, "line-width": 2.5 } });
      map.addLayer({ id: "rf-route-poor", type: "circle", source: "rf-route-poor", paint: { "circle-radius": 3, "circle-color": warn, "circle-stroke-color": halo, "circle-stroke-width": 1 } });
      map.addLayer({
        id: "rf-route-ends", type: "circle", source: "rf-route-ends",
        paint: { "circle-radius": 6, "circle-color": ["match", ["get", "kind"], "start", halo, primary], "circle-stroke-color": primary, "circle-stroke-width": 2.5 },
      });
    }
  }, [map, styleVersion, positions]);

  useEffect(() => {
    if (positions.length < 2) return;
    const b = new LngLatBounds();
    for (const p of positions) b.extend([p.lon, p.lat]);
    map.fitBounds(b, { padding: 40, maxZoom: 15, animate: false });
  }, [map, positions]);

  return null;
}
