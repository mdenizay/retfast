/** Canvas-drawn marker icons (sdf-free so we control fill/hollow/dashed). Registered per style load. */
import type { Map as MLMap } from "maplibre-gl";
import { tokenColor } from "@/components/map/maplibre";

const SIZE = 64; // drawn at 2x, displayed at pixelRatio 2 → 32 px

function ctx2d(): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext("2d");
  return ctx ? [c, ctx] : null;
}

function chevronPath(ctx: CanvasRenderingContext2D) {
  // Points north (up); icon-rotate applies heading.
  ctx.beginPath();
  ctx.moveTo(32, 8);
  ctx.lineTo(52, 54);
  ctx.lineTo(32, 43);
  ctx.lineTo(12, 54);
  ctx.closePath();
}

type Style = "solid" | "hollow" | "dashed";

function draw(kind: "chevron" | "dot", style: Style, color: string, halo: string): ImageData | null {
  const r = ctx2d();
  if (!r) return null;
  const [, ctx] = r;
  ctx.lineJoin = "round";
  if (kind === "chevron") {
    chevronPath(ctx);
    ctx.lineWidth = 8;
    ctx.strokeStyle = halo;
    ctx.stroke();
    chevronPath(ctx);
    if (style === "solid") {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.fillStyle = halo;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = color;
      if (style === "dashed") ctx.setLineDash([6, 5]);
      chevronPath(ctx);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.arc(32, 32, 14, 0, Math.PI * 2);
    ctx.lineWidth = 8;
    ctx.strokeStyle = halo;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(32, 32, 14, 0, Math.PI * 2);
    if (style === "solid") {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.fillStyle = halo;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = color;
      if (style === "dashed") ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(32, 32, 14, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return ctx.getImageData(0, 0, SIZE, SIZE);
}

export const ICONS = {
  live: { chevron: "rf-live-chevron", dot: "rf-live-dot" },
  stale: { chevron: "rf-stale-chevron", dot: "rf-stale-dot" },
  lost: { chevron: "rf-lost-chevron", dot: "rf-lost-dot" },
} as const;

export function registerIcons(map: MLMap) {
  const halo = tokenColor("surface", "#ffffff");
  const colors = {
    live: tokenColor("tracking-active", "#0C7469"),
    stale: tokenColor("tracking-stale", "#8F5500"),
    lost: tokenColor("offline", "#566A7B"),
  };
  const styles: Record<keyof typeof ICONS, Style> = { live: "solid", stale: "hollow", lost: "dashed" };
  for (const f of Object.keys(ICONS) as (keyof typeof ICONS)[]) {
    for (const kind of ["chevron", "dot"] as const) {
      const id = ICONS[f][kind];
      const img = draw(kind, styles[f], colors[f], halo);
      if (!img) continue;
      if (map.hasImage(id)) map.removeImage(id);
      map.addImage(id, img, { pixelRatio: 2 });
    }
  }
}
