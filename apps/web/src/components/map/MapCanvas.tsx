import { useEffect, useRef, useState, type ReactNode } from "react";
import { Map as MLMap, NavigationControl, ScaleControl, AttributionControl } from "maplibre-gl";
import { MAP_STYLES } from "@/lib/config";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { webglAvailable } from "./maplibre";

export interface MapReady {
  map: MLMap;
  /** Increments every time the style (re)loads — custom sources/layers must be re-added. */
  styleVersion: number;
}

interface Props {
  className?: string;
  initialCenter?: [number, number];
  initialZoom?: number;
  label: string;
  children?: (ready: MapReady) => ReactNode;
}

/** Theme-aware MapLibre canvas (OpenFreeMap liberty / dark). Renders children once the style is loaded. */
export function MapCanvas({ className, initialCenter = [29.0, 39.0], initialZoom = 5, label, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();
  const { t } = useI18n();
  const [ready, setReady] = useState<MapReady | null>(null);
  const [failed, setFailed] = useState(() => !webglAvailable());
  const mapRef = useRef<MLMap | null>(null);
  const themeRef = useRef(resolved);

  useEffect(() => {
    if (failed || !ref.current) return;
    let map: MLMap;
    try {
      map = new MLMap({
        container: ref.current,
        style: MAP_STYLES[themeRef.current],
        center: initialCenter,
        zoom: initialZoom,
        attributionControl: false,
        cooperativeGestures: false,
        maxPitch: 0,
        dragRotate: false,
      });
    } catch {
      void Promise.resolve().then(() => setFailed(true));
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    let version = 0;
    const onStyle = () => {
      version += 1;
      setReady({ map, styleVersion: version });
    };
    map.on("style.load", onStyle);
    return () => {
      map.off("style.load", onStyle);
      map.remove();
      mapRef.current = null;
      setReady(null);
    };
    // initialCenter/zoom intentionally only used on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);

  useEffect(() => {
    if (themeRef.current === resolved) return;
    themeRef.current = resolved;
    mapRef.current?.setStyle(MAP_STYLES[resolved]);
  }, [resolved]);

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-background", className)}>
      <div ref={ref} className="h-full w-full" role="region" aria-label={label} />
      {failed && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-footnote text-fg-muted">
          {t("map.unavailable")}
        </div>
      )}
      {ready && children?.(ready)}
    </div>
  );
}
