"use client";
import { Box, Layers } from "lucide-react";
import { BASEMAPS, type BasemapId } from "@/lib/basemaps";
import { useI18n } from "@/lib/i18n";
import { resolveBasemap, setMapPrefs, useMapPrefs } from "@/lib/map-prefs";
import { useTheme } from "@/lib/theme";
import { Popover, PopoverContent, PopoverTrigger, Switch, Tooltip, TooltipContent, TooltipTrigger, cx } from "./ui";

const PREVIEW: Record<BasemapId, string> = {
  dark: "linear-gradient(145deg,#34343a 0%,#16161a 60%,#26262b 100%)",
  light: "linear-gradient(145deg,#fafaf7 0%,#dfe3e8 55%,#cfd6de 100%)",
  city: "linear-gradient(145deg,#f1ead2 0%,#b9dcae 50%,#9cc9ec 100%)",
  satellite: "linear-gradient(145deg,#3d4f2e 0%,#7a7451 45%,#27384f 100%)",
};

/** Katman seçici: iOS Haritalar'daki gibi tek düğme, açılır cam kart. */
export function MapLayerControl({ placement = "down", className }: { placement?: "up" | "down"; className?: string }) {
  const { t } = useI18n();
  const prefs = useMapPrefs();
  const { resolved } = useTheme();
  const active = resolveBasemap(prefs, resolved);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button aria-label={t("map.layers")}
              className={cx("glass press flex h-11 w-11 items-center justify-center rounded-full text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60", className)}>
              <Layers size={19} strokeWidth={1.8} />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={placement === "up" ? "top" : "bottom"}>{t("map.layers")}</TooltipContent>
      </Tooltip>
      <PopoverContent side={placement === "up" ? "top" : "bottom"} align="end" className="w-[280px]">
        <p className="t-section px-1">{t("map.layers")}</p>
        <div className="grid grid-cols-2 gap-2.5">
          {BASEMAPS.map((b) => (
            <button key={b} onClick={() => setMapPrefs({ basemap: b })} className="press text-left outline-none" aria-pressed={active === b}>
              <span className={cx("block h-[68px] rounded-[16px] transition", active === b ? "ring-2 ring-tint ring-offset-2 ring-offset-popover" : "ring-1 ring-inset ring-hair")}
                style={{ background: PREVIEW[b] }} />
              <span className={cx("mt-1.5 block px-0.5 text-[13px]", active === b ? "font-semibold text-foreground" : "text-muted-foreground")}>{t(`map.${b}`)}</span>
            </button>
          ))}
        </div>
        <label className="tile flex cursor-pointer items-center gap-3 rounded-[16px] px-3.5 py-3">
          <Box size={18} strokeWidth={1.8} className="text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium">{t("map.3d")}</span>
            <span className="t-foot block">{t("map.3d_hint")}</span>
          </span>
          <Switch checked={prefs.threeD} onCheckedChange={(v) => setMapPrefs({ threeD: v })} />
        </label>
      </PopoverContent>
    </Popover>
  );
}
