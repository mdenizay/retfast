import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getMapStyle, ZONE_COLORS } from "@/lib/map/provider";
import type { GeoZone } from "@/lib/types";

interface MapViewProps {
  className?: string;
  center?: [number, number]; // [lng, lat]
  zoom?: number;
  zones?: GeoZone[];
  onReady?: (map: MLMap) => void;
}

const ZONES_SRC = "retfast-zones";

export function zonesToFeatureCollection(zones: GeoZone[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones.map((z) => ({
      type: "Feature",
      id: z.id,
      geometry: z.geometry,
      properties: {
        name: z.name,
        zone_type: z.zone_type,
        color: (z.properties?.color as string) ?? ZONE_COLORS[z.zone_type] ?? "#7c3aed",
      },
    })),
  };
}

function syncZones(map: MLMap, zones: GeoZone[]) {
  const fc = zonesToFeatureCollection(zones);
  const src = map.getSource(ZONES_SRC) as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(fc);
    return;
  }
  map.addSource(ZONES_SRC, { type: "geojson", data: fc });
  map.addLayer({
    id: `${ZONES_SRC}-fill`,
    type: "fill",
    source: ZONES_SRC,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.15 },
  });
  map.addLayer({
    id: `${ZONES_SRC}-line`,
    type: "line",
    source: ZONES_SRC,
    filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]],
    paint: { "line-color": ["get", "color"], "line-width": 2 },
  });
  map.addLayer({
    id: `${ZONES_SRC}-point`,
    type: "circle",
    source: ZONES_SRC,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": 6,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: `${ZONES_SRC}-label`,
    type: "symbol",
    source: ZONES_SRC,
    layout: {
      "text-field": ["get", "name"],
      "text-size": 11,
      "text-offset": [0, 1.2],
      "text-anchor": "top",
    },
    paint: {
      "text-color": "#111827",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.5,
    },
  });
}

export default function MapView({ className, center, zoom, zones, onReady }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const zonesRef = useRef<GeoZone[]>(zones ?? []);
  zonesRef.current = zones ?? [];

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapStyle(),
      center: center ?? [29.34, 37.05],
      zoom: zoom ?? 11,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    map.on("load", () => {
      syncZones(map, zonesRef.current);
      onReady?.(map);
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // The map is created exactly once; zones/center updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) syncZones(map, zones ?? []);
  }, [zones]);

  return <div ref={containerRef} className={className ?? "h-96 w-full rounded-md"} />;
}
