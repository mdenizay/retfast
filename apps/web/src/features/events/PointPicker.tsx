import { useEffect, useRef } from "react";
import type { MapMouseEvent } from "maplibre-gl";
import type { LatLon } from "@/lib/api/types";
import { MapCanvas, type MapReady } from "@/components/map/MapCanvas";
import { EMPTY_FC, LABEL_FONT, setGeoJSON, tokenColor } from "@/components/map/maplibre";

export interface PickerPoint extends LatLon {
  id: string;
  label: string;
  verified?: boolean;
}

/** Click the map to choose a coordinate. Existing points (e.g. launch sites) are shown for context. */
export function PointPicker({
  value, onChange, points = [], label, center, className,
}: {
  value: LatLon | null;
  onChange: (p: LatLon) => void;
  points?: PickerPoint[];
  label: string;
  center?: LatLon | null;
  className?: string;
}) {
  const c = value ?? center;
  return (
    <div className={className ?? "h-72 overflow-hidden rounded-2xl"}>
      <MapCanvas label={label} initialCenter={c ? [c.lon, c.lat] : undefined} initialZoom={c ? 11 : 5}>
        {(ready) => <PickerLayers {...ready} value={value} onChange={onChange} points={points} />}
      </MapCanvas>
    </div>
  );
}

function PickerLayers({ map, styleVersion, value, onChange, points }: MapReady & { value: LatLon | null; onChange: (p: LatLon) => void; points: PickerPoint[] }) {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const primary = tokenColor("primary", "#0C7469");
    const halo = tokenColor("surface", "#fff");
    const text = tokenColor("text-primary", "#101923");
    const warn = tokenColor("warning", "#8F5500");
    setGeoJSON(map, "rf-pick", EMPTY_FC);
    setGeoJSON(map, "rf-pick-ctx", EMPTY_FC);
    if (!map.getLayer("rf-pick")) {
      map.addLayer({
        id: "rf-pick-ctx", type: "circle", source: "rf-pick-ctx",
        paint: { "circle-radius": 5, "circle-color": halo, "circle-stroke-width": 2, "circle-stroke-color": ["case", ["get", "verified"], primary, warn] },
      });
      map.addLayer({
        id: "rf-pick-ctx-label", type: "symbol", source: "rf-pick-ctx",
        layout: { "text-field": ["get", "label"], "text-font": LABEL_FONT, "text-size": 12, "text-offset": [0, 1.2], "text-anchor": "top" },
        paint: { "text-color": text, "text-halo-color": halo, "text-halo-width": 1.5 },
      });
      map.addLayer({ id: "rf-pick", type: "circle", source: "rf-pick", paint: { "circle-radius": 8, "circle-color": primary, "circle-stroke-width": 3, "circle-stroke-color": halo } });
    }
    const click = (e: MapMouseEvent) => cb.current({ lat: Number(e.lngLat.lat.toFixed(6)), lon: Number(e.lngLat.lng.toFixed(6)) });
    map.on("click", click);
    map.getCanvas().style.cursor = "crosshair";
    return () => {
      map.off("click", click);
    };
  }, [map, styleVersion]);

  useEffect(() => {
    setGeoJSON(map, "rf-pick", {
      type: "FeatureCollection",
      features: value ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [value.lon, value.lat] } }] : [],
    });
  }, [map, styleVersion, value]);

  useEffect(() => {
    setGeoJSON(map, "rf-pick-ctx", {
      type: "FeatureCollection",
      features: points.map((p) => ({ type: "Feature", properties: { label: p.label, verified: Boolean(p.verified) }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } })),
    });
  }, [map, styleVersion, points]);

  return null;
}
