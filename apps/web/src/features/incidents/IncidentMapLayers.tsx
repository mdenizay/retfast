import { useEffect } from "react";
import type { MapReady } from "@/components/map/MapCanvas";
import { circlePolygon, setGeoJSON, tokenColor } from "@/components/map/maplibre";
import type { Position } from "@/lib/api/types";

export function IncidentMapLayers({ map, styleVersion, lat, lon, accuracyM, trail }: MapReady & { lat: number; lon: number; accuracyM: number | null; trail: Position[] }) {
  useEffect(() => {
    const emergency = tokenColor("emergency", "#B3202C");
    const halo = tokenColor("surface", "#fff");
    const muted = tokenColor("text-secondary", "#3B4E5F");
    setGeoJSON(map, "rf-inc-acc", {
      type: "FeatureCollection",
      features: accuracyM && accuracyM > 0 ? [{ type: "Feature", properties: {}, geometry: circlePolygon(lon, lat, accuracyM) }] : [],
    });
    setGeoJSON(map, "rf-inc-trail", {
      type: "FeatureCollection",
      features: trail.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: trail.map((p) => [p.lon, p.lat]) } }] : [],
    });
    setGeoJSON(map, "rf-inc-pos", { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lon, lat] } }] });
    if (!map.getLayer("rf-inc-pos")) {
      map.addLayer({ id: "rf-inc-trail", type: "line", source: "rf-inc-trail", paint: { "line-color": muted, "line-width": 2, "line-dasharray": [1.5, 1.5] } });
      map.addLayer({ id: "rf-inc-acc-fill", type: "fill", source: "rf-inc-acc", paint: { "fill-color": emergency, "fill-opacity": 0.12 } });
      map.addLayer({ id: "rf-inc-acc-line", type: "line", source: "rf-inc-acc", paint: { "line-color": emergency, "line-width": 1.5 } });
      map.addLayer({ id: "rf-inc-pos", type: "circle", source: "rf-inc-pos", paint: { "circle-radius": 9, "circle-color": emergency, "circle-stroke-color": halo, "circle-stroke-width": 3 } });
    }
  }, [map, styleVersion, lat, lon, accuracyM, trail]);
  return null;
}
