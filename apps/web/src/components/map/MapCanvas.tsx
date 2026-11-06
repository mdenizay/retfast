import { useEffect, useRef, useState, type ReactNode } from "react";
import { Map as MLMap, NavigationControl, ScaleControl, AttributionControl } from "maplibre-gl";
import { Check, Layers } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { webglAvailable } from "./maplibre";
import { BASEMAPS, basemapStyle, setBasemap, useBasemap } from "./basemap";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  /** Show the base map (standard / topo / satellite) switcher. */
  layerSwitcher?: boolean;
}

/** Theme-aware MapLibre canvas (OpenFreeMap liberty / dark). Renders children once the style is loaded. */
export function MapCanvas({ className, initialCenter = [29.0, 39.0], initialZoom = 5, label, children, layerSwitcher = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();
  const { t } = useI18n();
  const [ready, setReady] = useState<MapReady | null>(null);
  const [failed, setFailed] = useState(() => !webglAvailable());
  const mapRef = useRef<MLMap | null>(null);
  const basemap = useBasemap();
  const styleRef = useRef({ theme: resolved, basemap });

  useEffect(() => {
    if (failed || !ref.current) return;
    let map: MLMap;
    try {
      map = new MLMap({
        container: ref.current,
        style: basemapStyle(styleRef.current.basemap, styleRef.current.theme),
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
    const prev = styleRef.current;
    if (prev.theme === resolved && prev.basemap === basemap) return;
    styleRef.current = { theme: resolved, basemap };
    // Theme only matters for the vector base map.
    if (prev.basemap === basemap && basemap !== "standard") return;
    mapRef.current?.setStyle(basemapStyle(basemap, resolved), { diff: false });
  }, [resolved, basemap]);

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-background", className)}>
      <div ref={ref} className="h-full w-full" role="region" aria-label={label} />
      {failed && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-footnote text-fg-muted">
          {t("map.unavailable")}
        </div>
      )}
      {ready && children?.(ready)}
      {layerSwitcher && !failed && <BasemapSwitcher />}
    </div>
  );
}

function BasemapSwitcher() {
  const { t } = useI18n();
  const current = useBasemap();
  return (
    <div className="absolute top-2.5 left-2.5 z-[5]">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("map.layers")}
            title={t("map.layers")}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface/95 px-3 text-footnote font-medium text-fg shadow-[0_2px_10px_rgb(0_0_0/0.18)] backdrop-blur transition-colors hover:bg-surface"
          >
            <Layers className="size-4" aria-hidden />
            <span className="hidden sm:inline">{t(`map.layer.${current}`)}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel>{t("map.layers")}</DropdownMenuLabel>
          {BASEMAPS.map((b) => (
            <DropdownMenuItem key={b} onSelect={() => setBasemap(b)} className="justify-between">
              {t(`map.layer.${b}`)}
              {b === current && <Check className="size-4 text-brand" aria-hidden />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
