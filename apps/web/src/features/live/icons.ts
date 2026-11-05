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

/** Ended flight (landed): neutral solid dot — freshness styling applies only to recording flights. */
export const LANDED_ICON = "rf-landed-dot";

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
  const landed = draw("dot", "solid", tokenColor("text-secondary", "#3B4E5F"), halo);
  if (landed) {
    if (map.hasImage(LANDED_ICON)) map.removeImage(LANDED_ICON);
    map.addImage(LANDED_ICON, landed, { pixelRatio: 2 });
  }
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

/* ---------- retrieval pins and retriever vehicles ---------- */

function pinPath(ctx: CanvasRenderingContext2D) {
  // Teardrop pointing down to (32, 58).
  ctx.beginPath();
  ctx.moveTo(32, 58);
  ctx.bezierCurveTo(22, 44, 12, 36, 12, 24);
  ctx.arc(32, 24, 20, Math.PI, 0);
  ctx.bezierCurveTo(52, 36, 42, 44, 32, 58);
  ctx.closePath();
}

function drawPin(color: string, halo: string, hollow: boolean): ImageData | null {
  const r = ctx2d();
  if (!r) return null;
  const [, ctx] = r;
  ctx.lineJoin = "round";
  pinPath(ctx);
  ctx.lineWidth = 7;
  ctx.strokeStyle = halo;
  ctx.stroke();
  pinPath(ctx);
  ctx.fillStyle = hollow ? halo : color;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  pinPath(ctx);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(32, 24, 7, 0, Math.PI * 2);
  ctx.fillStyle = hollow ? color : halo;
  ctx.fill();
  return ctx.getImageData(0, 0, SIZE, SIZE);
}

function squarePath(ctx: CanvasRenderingContext2D) {
  const x = 14, y = 14, w = 36, rr = 8;
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + w, rr);
  ctx.arcTo(x + w, y + w, x, y + w, rr);
  ctx.arcTo(x, y + w, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Retriever = rounded square (distinct from the pilot chevron) with an inner heading arrow when moving. */
function drawVehicle(style: Style, moving: boolean, color: string, halo: string): ImageData | null {
  const r = ctx2d();
  if (!r) return null;
  const [, ctx] = r;
  squarePath(ctx);
  ctx.lineWidth = 8;
  ctx.strokeStyle = halo;
  ctx.stroke();
  squarePath(ctx);
  ctx.fillStyle = style === "solid" ? color : halo;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  if (style === "dashed") ctx.setLineDash([6, 5]);
  squarePath(ctx);
  ctx.stroke();
  ctx.setLineDash([]);
  const inner = style === "solid" ? halo : color;
  ctx.fillStyle = inner;
  ctx.beginPath();
  if (moving) {
    ctx.moveTo(32, 20);
    ctx.lineTo(42, 42);
    ctx.lineTo(32, 37);
    ctx.lineTo(22, 42);
    ctx.closePath();
  } else {
    ctx.arc(32, 32, 5, 0, Math.PI * 2);
  }
  ctx.fill();
  return ctx.getImageData(0, 0, SIZE, SIZE);
}

/** Pilot's latest on-ground position shared inside a retrieval: ringed dot. */
function drawGroundDot(color: string, halo: string): ImageData | null {
  const r = ctx2d();
  if (!r) return null;
  const [, ctx] = r;
  ctx.beginPath();
  ctx.arc(32, 32, 11, 0, Math.PI * 2);
  ctx.lineWidth = 8;
  ctx.strokeStyle = halo;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(32, 32, 4, 0, Math.PI * 2);
  ctx.fillStyle = halo;
  ctx.fill();
  return ctx.getImageData(0, 0, SIZE, SIZE);
}

export const RETRIEVAL_ICONS = {
  pinRequested: "rf-pin-requested",
  pinAccepted: "rf-pin-accepted",
  ground: "rf-ground-dot",
  vehicle: {
    live: { moving: "rf-veh-live-m", still: "rf-veh-live-s" },
    stale: { moving: "rf-veh-stale-m", still: "rf-veh-stale-s" },
    lost: { moving: "rf-veh-lost-m", still: "rf-veh-lost-s" },
  },
} as const;

export function registerRetrievalIcons(map: MLMap) {
  const halo = tokenColor("surface", "#ffffff");
  const retrieval = tokenColor("retrieval", "#7440A8");
  const secondary = tokenColor("secondary", "#2B6894");
  const put = (id: string, img: ImageData | null) => {
    if (!img) return;
    if (map.hasImage(id)) map.removeImage(id);
    map.addImage(id, img, { pixelRatio: 2 });
  };
  put(RETRIEVAL_ICONS.pinRequested, drawPin(retrieval, halo, false));
  put(RETRIEVAL_ICONS.pinAccepted, drawPin(secondary, halo, true));
  put(RETRIEVAL_ICONS.ground, drawGroundDot(retrieval, halo));
  const styles: Record<"live" | "stale" | "lost", Style> = { live: "solid", stale: "hollow", lost: "dashed" };
  for (const f of ["live", "stale", "lost"] as const) {
    put(RETRIEVAL_ICONS.vehicle[f].moving, drawVehicle(styles[f], true, secondary, halo));
    put(RETRIEVAL_ICONS.vehicle[f].still, drawVehicle(styles[f], false, secondary, halo));
  }
}
