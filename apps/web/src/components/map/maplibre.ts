/** MapLibre setup shared by all map views (worker URL, theme-aware style, helpers). */
import "maplibre-gl/dist/maplibre-gl.css";
import { setWorkerUrl, type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { FeatureCollection, Geometry } from "geojson";

setWorkerUrl(workerUrl);

export const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };
export const LABEL_FONT = ["Noto Sans Regular"];

export function setGeoJSON(map: MLMap, id: string, data: FeatureCollection) {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src) src.setData(data);
  else map.addSource(id, { type: "geojson", data });
}

/** Read an Aero token ("r g b" triplet) as a CSS color string. */
export function tokenColor(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--rf-${name}`).trim();
  return v ? `rgb(${v.split(/\s+/).join(",")})` : fallback;
}

export function webglAvailable(): boolean {
  try {
    if (typeof window === "undefined" || !("WebGLRenderingContext" in window)) return false;
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/** Geodesic-ish circle polygon (good enough for accuracy radii up to a few km). */
export function circlePolygon(lon: number, lat: number, radiusM: number, steps = 64): Geometry {
  const coords: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    coords.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Polygon", coordinates: [coords] };
}
