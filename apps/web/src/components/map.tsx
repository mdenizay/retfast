"use client";
// MapLibre sarmalayıcı. Stil ortam değişkeninden gelir (sağlayıcı kod değişmeden değişir);
// dağlık bölgeler için açık yükselti verisinden (Terrarium) gölgelendirme eklenir.
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { useEffect, useRef, type ReactNode } from "react";

// `||`: derleme ortamı değişkeni boş metin olarak gömebilir; boşsa da varsayılana düş.
const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE || "https://tiles.openfreemap.org/styles/dark";
// MapLibre paketlenmez: yayınlanan ES modülü public/maplibre altından olduğu gibi yüklenir
// (copy-assets). Turbopack paketlemesi kütüphanenin modül worker'ını bozuyor; bu yolla worker
// ana modülün yanından, kütüphanenin kendi mekanizmasıyla yüklenir.
type Lib = typeof import("maplibre-gl");
let lib: Promise<Lib> | null = null;
function loadMaplibre(): Promise<Lib> {
  const url = "/maplibre/maplibre-gl.mjs";
  return (lib ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url) as Promise<Lib>);
}
const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

export function MapView({
  center,
  zoom = 10,
  onReady,
  onClick,
  controls = true,
  className,
  children,
}: {
  center: [number, number];
  zoom?: number;
  onReady: (map: MlMap) => void;
  onClick?: (lngLat: { lng: number; lat: number }) => void;
  /** false: sayfa kendi yuvarlak kontrollerini çizer. */
  controls?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const el = useRef<HTMLDivElement>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    let map: MlMap | null = null;
    let cancelled = false;
    void loadMaplibre().then((ml) => {
      if (cancelled || !el.current) return;
      map = new ml.Map({ container: el.current, style: STYLE, center, zoom, attributionControl: { compact: true } });
      const m = map;
      if (process.env.NODE_ENV !== "production") (window as unknown as { __rfmap: MlMap }).__rfmap = m;
      if (controls) m.addControl(new ml.NavigationControl({ visualizePitch: false }), "bottom-right");
      m.addControl(new ml.ScaleControl({ unit: "metric" }), "bottom-right");
      m.on("load", () => {
        m.addSource("dem", { type: "raster-dem", tiles: [DEM], tileSize: 256, encoding: "terrarium", maxzoom: 14,
          attribution: "Elevation: Mapzen Terrain Tiles" });
        const firstSymbol = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
        m.addLayer({ id: "hillshade", type: "hillshade", source: "dem",
          paint: { "hillshade-exaggeration": 0.75, "hillshade-shadow-color": "#000000",
            "hillshade-highlight-color": "#5d6168", "hillshade-accent-color": "#1d1f23" } }, firstSymbol);
        onReady(m);
      });
      m.on("click", (e) => clickRef.current?.(e.lngLat));
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
    // Harita bir kez kurulur; merkez değişimi çağıran tarafından flyTo ile yapılır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className ?? "relative h-full w-full"}>
      <div ref={el} className="h-full w-full" />
      {children}
    </div>
  );
}

export const POINT_COLORS: Record<string, string> = {
  takeoff: "#6cc0ff",
  landing: "#45d483",
  alt_landing: "#a3d977",
  emergency_landing: "#ff8a3d",
  meeting: "#c79bff",
  hazard: "#ff5a4a",
};

/** Etkinlik noktaları ve bölgeleri (statik katmanlar). */
export function setEventFeatures(
  map: MlMap,
  points: { id: string; kind: string; name: string; lat: number; lon: number }[],
  zones: { id: string; kind: string; name: string; geojson: unknown }[],
) {
  const pts = { type: "FeatureCollection" as const, features: points.map((p) => ({ type: "Feature" as const, id: p.id,
    geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] }, properties: { name: p.name, color: POINT_COLORS[p.kind] ?? "#fff" } })) };
  const zs = { type: "FeatureCollection" as const, features: zones.map((z) => ({ type: "Feature" as const, id: z.id,
    geometry: z.geojson as import("geojson").Geometry, properties: { name: z.name, color: z.kind === "hazard" ? "#ff5a4a" : z.kind === "boundary" ? "#f3a712" : "#5ab8ff" } })) };
  const src = map.getSource("event-points") as GeoJSONSource | undefined;
  if (src) {
    src.setData(pts);
    (map.getSource("event-zones") as GeoJSONSource).setData(zs);
    return;
  }
  map.addSource("event-zones", { type: "geojson", data: zs });
  map.addLayer({ id: "zones-fill", type: "fill", source: "event-zones", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.08 } });
  map.addLayer({ id: "zones-line", type: "line", source: "event-zones", paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [2, 2] } });
  map.addSource("event-points", { type: "geojson", data: pts });
  map.addLayer({ id: "points", type: "circle", source: "event-points",
    paint: { "circle-radius": 5, "circle-color": "#0a0b0d", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2.5 } });
  map.addLayer({ id: "points-label", type: "symbol", source: "event-points",
    layout: { "text-field": ["get", "name"], "text-size": 11, "text-font": ["Noto Sans Regular"], "text-offset": [0, 1.3], "text-anchor": "top" },
    paint: { "text-color": "#c9cbd0", "text-halo-color": "#0a0b0d", "text-halo-width": 1.5 } });
}
