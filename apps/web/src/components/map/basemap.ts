/** Base map choice (standard vector / topographic / satellite), remembered per browser. */
import { useSyncExternalStore } from "react";
import type { StyleSpecification } from "maplibre-gl";
import { MAP_STYLES } from "@/lib/config";

export const BASEMAPS = ["standard", "topo", "satellite"] as const;
export type Basemap = (typeof BASEMAPS)[number];

const KEY = "rf.basemap";
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

function raster(id: string, tiles: string[], attribution: string, maxzoom: number): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: { [id]: { type: "raster", tiles, tileSize: 256, maxzoom, attribution } },
    layers: [{ id, type: "raster", source: id }],
  };
}

const TOPO = raster(
  "rf-topo",
  ["a", "b", "c"].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
  'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · Style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  17,
);

const SATELLITE = raster(
  "rf-satellite",
  ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
  "Imagery © Esri, Maxar, Earthstar Geographics",
  19,
);

export function basemapStyle(b: Basemap, theme: "light" | "dark"): string | StyleSpecification {
  if (b === "topo") return TOPO;
  if (b === "satellite") return SATELLITE;
  return MAP_STYLES[theme];
}

const listeners = new Set<() => void>();

function read(): Basemap {
  try {
    const v = localStorage.getItem(KEY);
    return (BASEMAPS as readonly string[]).includes(v ?? "") ? (v as Basemap) : "standard";
  } catch {
    return "standard";
  }
}

let current: Basemap = typeof window === "undefined" ? "standard" : read();

export function setBasemap(b: Basemap) {
  current = b;
  try {
    localStorage.setItem(KEY, b);
  } catch {
    /* private mode: keep in memory */
  }
  listeners.forEach((l) => l());
}

export function useBasemap(): Basemap {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => "standard",
  );
}
