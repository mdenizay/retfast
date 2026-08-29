import type { StyleSpecification } from "maplibre-gl";

// Map provider abstraction: feature code asks for "the style" and never
// hardcodes a vendor. Configure VITE_MAP_STYLE_URL (MapTiler, OpenFreeMap,
// self-hosted…) — otherwise we fall back to a plain OSM raster style that
// needs no API key.

const osmRasterStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

export function getMapStyle(): string | StyleSpecification {
  const url = import.meta.env.VITE_MAP_STYLE_URL as string | undefined;
  return url && url.length > 0 ? url : osmRasterStyle;
}

export const ZONE_COLORS: Record<string, string> = {
  takeoff: "#16a34a",
  landing: "#2563eb",
  restricted: "#dc2626",
  checkpoint: "#d97706",
  custom: "#7c3aed",
};
