"use client";
// MapLibre sarmalayıcı. Kütüphane paketlenmez: yayınlanan ES modülü public/maplibre altından yüklenir
// (copy-assets); Turbopack paketlemesi kütüphanenin modül worker'ını bozuyor.
//
// Alt harita (karanlık/aydınlık/şehir/uydu) ve 3B (eğim + arazi + binalar) seçimi paylaşılan tercihlerden
// gelir. Stil her değiştiğinde özel kaynaklar silindiği için `onReady` HER stil yüklemesinden sonra çağrılır;
// çağıran taraf katmanlarını idempotent biçimde yeniden eklemelidir.
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { useEffect, useRef, type ReactNode } from "react";
import { basemapStyle, isDarkBase, type BasemapId } from "@/lib/basemaps";
import { resolveBasemap, useMapPrefs } from "@/lib/map-prefs";
import { useTheme } from "@/lib/theme";
import { MapLayerControl } from "./map-controls";

type Lib = typeof import("maplibre-gl");
let lib: Promise<Lib> | null = null;
function loadMaplibre(): Promise<Lib> {
  const url = "/maplibre/maplibre-gl.mjs";
  return (lib ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url) as Promise<Lib>);
}

const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const THREE_D = { pitch: 62, bearing: -22 };

export function useResolvedBasemap(): BasemapId {
  const prefs = useMapPrefs();
  const { resolved } = useTheme();
  return resolveBasemap(prefs, resolved);
}

function prepare(m: MlMap, base: BasemapId, threeD: boolean) {
  if (!m.getSource("dem")) {
    m.addSource("dem", { type: "raster-dem", tiles: [DEM], tileSize: 256, encoding: "terrarium", maxzoom: 14, attribution: "Elevation: Mapzen" });
  }
  const firstSymbol = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
  if (base !== "satellite" && !m.getLayer("hillshade")) {
    const dark = isDarkBase(base);
    m.addLayer({
      id: "hillshade", type: "hillshade", source: "dem",
      paint: dark
        ? { "hillshade-exaggeration": 0.7, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#6b6f78", "hillshade-accent-color": "#1b1c20" }
        : { "hillshade-exaggeration": base === "city" ? 0.28 : 0.32, "hillshade-shadow-color": "#5b6270", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#c4cad4" },
    }, firstSymbol);
  }
  applyThreeD(m, base, threeD);
}

function applyThreeD(m: MlMap, base: BasemapId, threeD: boolean) {
  try {
    m.setTerrain(threeD ? { source: "dem", exaggeration: 1.3 } : null);
  } catch {
    /* kaynak henüz hazır değil; sonraki style.load yeniden dener */
  }
  const has3dBuildings = !!m.getLayer("building-3d");
  if (threeD && !has3dBuildings && !m.getLayer("rf-buildings") && m.getSource("openmaptiles")) {
    const dark = isDarkBase(base);
    m.addLayer({
      id: "rf-buildings", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 14,
      paint: {
        "fill-extrusion-color": dark ? "#3a3a40" : "#dcdce2",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.88,
      },
    });
  } else if (!threeD && m.getLayer("rf-buildings")) {
    m.removeLayer("rf-buildings");
  }
}

export function MapView({
  center, zoom = 10, onReady, onClick, chrome = true, className, children,
}: {
  center: [number, number];
  zoom?: number;
  /** Her stil yüklemesinden sonra çağrılır. */
  onReady: (map: MlMap, base: BasemapId) => void;
  onClick?: (lngLat: { lng: number; lat: number }) => void;
  /** true: sağ üstte katman denetimini gösterir. */
  chrome?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const prefs = useMapPrefs();
  const base = useResolvedBasemap();
  const baseRef = useRef(base);
  const threeRef = useRef(prefs.threeD);
  const appliedBase = useRef<BasemapId | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadMaplibre().then((ml) => {
      if (cancelled || !el.current) return;
      const m = new ml.Map({
        container: el.current, style: basemapStyle(baseRef.current), center, zoom, maxPitch: 75,
        pitch: threeRef.current ? THREE_D.pitch : 0, bearing: threeRef.current ? THREE_D.bearing : 0,
        attributionControl: { compact: true },
      });
      mapRef.current = m;
      appliedBase.current = baseRef.current;
      if (process.env.NODE_ENV !== "production") (window as unknown as { __rfmap: MlMap }).__rfmap = m;
      m.addControl(new ml.ScaleControl({ unit: "metric" }), "bottom-right");
      m.on("style.load", () => {
        prepare(m, baseRef.current, threeRef.current);
        readyRef.current(m, baseRef.current);
      });
      m.on("click", (e) => clickRef.current?.(e.lngLat));
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Harita bir kez kurulur; merkez değişimini çağıran taraf easeTo ile yapar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Alt harita değişti → stili değiştir (özel katmanlar silinir, style.load onReady'yi yeniden çağırır).
  useEffect(() => {
    baseRef.current = base;
    const m = mapRef.current;
    if (m && appliedBase.current !== base) {
      appliedBase.current = base;
      m.setStyle(basemapStyle(base), { diff: false });
    }
  }, [base]);

  // 3B değişti → eğimi ve araziyi yumuşakça uygula.
  useEffect(() => {
    threeRef.current = prefs.threeD;
    const m = mapRef.current;
    if (!m || !m.isStyleLoaded()) return;
    applyThreeD(m, baseRef.current, prefs.threeD);
    m.easeTo({ pitch: prefs.threeD ? THREE_D.pitch : 0, bearing: prefs.threeD ? THREE_D.bearing : 0, duration: 1000 });
  }, [prefs.threeD]);

  return (
    <div className={className ?? "relative h-full w-full"}>
      <div ref={el} className="h-full w-full" />
      {chrome && <div className="absolute right-3 top-3 z-10"><MapLayerControl placement="down" /></div>}
      {children}
    </div>
  );
}

export const POINT_COLORS: Record<string, string> = {
  takeoff: "#0a84ff",
  landing: "#30d158",
  alt_landing: "#a3d977",
  emergency_landing: "#ff9f0a",
  meeting: "#bf5af2",
  hazard: "#ff453a",
};

/** Etkinlik noktaları ve bölgeleri. Stil değişince kaynaklar silinir; yeniden çağırmak güvenlidir. */
export function setEventFeatures(
  map: MlMap,
  points: { id: string; kind: string; name: string; lat: number; lon: number }[],
  zones: { id: string; kind: string; name: string; geojson: unknown }[],
  onDark: boolean,
) {
  const pts = { type: "FeatureCollection" as const, features: points.map((p) => ({ type: "Feature" as const, id: p.id,
    geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] }, properties: { name: p.name, color: POINT_COLORS[p.kind] ?? "#fff" } })) };
  const zs = { type: "FeatureCollection" as const, features: zones.map((z) => ({ type: "Feature" as const, id: z.id,
    geometry: z.geojson as import("geojson").Geometry, properties: { name: z.name, color: z.kind === "hazard" ? "#ff453a" : z.kind === "boundary" ? "#ffb020" : "#0a84ff" } })) };
  const text = onDark ? { "text-color": "#f5f5f7", "text-halo-color": "rgba(0,0,0,0.7)" } : { "text-color": "#1c1c1e", "text-halo-color": "rgba(255,255,255,0.9)" };
  const src = map.getSource("event-points") as GeoJSONSource | undefined;
  if (src) {
    src.setData(pts);
    (map.getSource("event-zones") as GeoJSONSource).setData(zs);
    map.setPaintProperty("points-label", "text-color", text["text-color"]);
    map.setPaintProperty("points-label", "text-halo-color", text["text-halo-color"]);
    map.setPaintProperty("points", "circle-color", onDark ? "#1c1c1e" : "#ffffff");
    return;
  }
  map.addSource("event-zones", { type: "geojson", data: zs });
  map.addLayer({ id: "zones-fill", type: "fill", source: "event-zones", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 } });
  map.addLayer({ id: "zones-line", type: "line", source: "event-zones", paint: { "line-color": ["get", "color"], "line-width": 1.8, "line-dasharray": [2, 2] } });
  map.addSource("event-points", { type: "geojson", data: pts });
  map.addLayer({ id: "points", type: "circle", source: "event-points",
    paint: { "circle-radius": 5.5, "circle-color": onDark ? "#1c1c1e" : "#ffffff", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 3 } });
  map.addLayer({ id: "points-label", type: "symbol", source: "event-points",
    layout: { "text-field": ["get", "name"], "text-size": 11.5, "text-font": ["Noto Sans Regular"], "text-offset": [0, 1.2], "text-anchor": "top" },
    paint: { ...text, "text-halo-width": 1.5 } });
}
