import type { StyleSpecification } from "maplibre-gl";

export type BasemapId = "dark" | "light" | "city" | "satellite";
export const BASEMAPS: BasemapId[] = ["dark", "light", "city", "satellite"];

const OFM = "https://tiles.openfreemap.org";
// Uydu görüntüsü yapılandırılabilir: üretimde kendi anahtarlı sağlayıcını (MapTiler, Stadia…) buraya ver.
const SAT_TILES = process.env.NEXT_PUBLIC_SATELLITE_TILES || "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SAT_ATTRIBUTION = process.env.NEXT_PUBLIC_SATELLITE_ATTRIBUTION || "Imagery © Esri, Maxar, Earthstar Geographics";

const satellite: StyleSpecification = {
  version: 8,
  glyphs: `${OFM}/fonts/{fontstack}/{range}.pbf`,
  sources: {
    sat: { type: "raster", tiles: [SAT_TILES], tileSize: 256, maxzoom: 19, attribution: SAT_ATTRIBUTION },
    omt: { type: "vector", url: `${OFM}/planet` },
  },
  layers: [
    { id: "sat", type: "raster", source: "sat" },
    {
      id: "place-label", type: "symbol", source: "omt", "source-layer": "place",
      filter: ["in", ["get", "class"], ["literal", ["city", "town", "village", "suburb"]]],
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 8, 11, 14, 15] },
      paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.65)", "text-halo-width": 1.4 },
    },
    {
      id: "peak-label", type: "symbol", source: "omt", "source-layer": "mountain_peak", minzoom: 9,
      filter: ["has", "name"],
      layout: {
        "text-field": ["concat", "▲ ", ["get", "name"], ["case", ["has", "ele"], ["concat", "  ", ["to-string", ["get", "ele"]], " m"], ""]],
        "text-font": ["Noto Sans Regular"], "text-size": 11, "text-anchor": "top", "text-offset": [0, 0.3],
      },
      paint: { "text-color": "#ffe9b3", "text-halo-color": "rgba(0,0,0,0.7)", "text-halo-width": 1.3 },
    },
  ],
};

export function basemapStyle(id: BasemapId): string | StyleSpecification {
  switch (id) {
    case "dark": return `${OFM}/styles/dark`;
    case "light": return `${OFM}/styles/positron`;
    case "city": return `${OFM}/styles/liberty`;
    case "satellite": return satellite;
  }
}

/** Koyu zeminde açık renkli etiket/çizgi gerekir. */
export const isDarkBase = (id: BasemapId) => id === "dark" || id === "satellite";
