import type { Map as MlMap } from "maplibre-gl";

/** Durum renkleri (iOS sistem renkleri). */
export const STATE_COLOR: Record<string, string> = {
  preparing: "#8e8e93",
  flying: "#0a84ff",
  landed: "#ffd60a",
  awaiting_retrieve: "#ff9f0a",
  retriever_assigned: "#bf5af2",
  picked_up: "#30d158",
  completed: "#636366",
  sos: "#ff453a",
  retriever: "#ffb020",
};

const SHADOW = `<filter id="s" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1.5" stdDeviation="2.2" flood-color="#000" flood-opacity="0.38"/></filter>`;

function svg(inner: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs>${SHADOW}</defs>${inner}</svg>`;
}

const dot = (c: string) => svg(`<circle cx="32" cy="32" r="11.5" fill="${c}" stroke="#fff" stroke-width="3.6" filter="url(#s)"/>`);
// Navigasyon oku: kuzeye bakar, `icon-rotate` ile yöne döner.
const arrow = (c: string) =>
  svg(`<circle cx="32" cy="32" r="16" fill="${c}" stroke="#fff" stroke-width="3.6" filter="url(#s)"/><path d="M32 22.5 39.6 41 32 37.2 24.4 41Z" fill="#fff" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>`);
const car = () =>
  svg(`<circle cx="32" cy="32" r="16" fill="#fff" stroke="#ffb020" stroke-width="3.6" filter="url(#s)"/>
  <g transform="translate(21.4 21.4) scale(0.88)" fill="none" stroke="#1c1c1e" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></g>`);

/** Baktığı yönü gösteren yarı saydam koni; merkezden kuzeye doğru açılır, `icon-rotate` ile yöne döner. */
const cone = (c: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><defs><radialGradient id="g" cx="48" cy="48" r="46" gradientUnits="userSpaceOnUse"><stop offset="0.12" stop-color="${c}" stop-opacity="0.7"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient></defs><path d="M48 48 L25 8.2 A46 46 0 0 1 71 8.2 Z" fill="url(#g)"/></svg>`;

function load(id: string, markup: string, size = 64): Promise<[string, HTMLImageElement]> {
  return new Promise((resolve, reject) => {
    const img = new Image(size, size);
    img.onload = () => resolve([id, img]);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

/** Stil değiştiğinde görseller silinir; her `style.load` sonrası çağır. */
export async function addMarkerImages(map: MlMap) {
  const jobs: Promise<[string, HTMLImageElement]>[] = [load("car", car())];
  for (const [k, c] of Object.entries(STATE_COLOR)) {
    jobs.push(load(`dot-${k}`, dot(c)), load(`arrow-${k}`, arrow(c)), load(`cone-${k}`, cone(c), 96));
  }
  for (const [id, img] of await Promise.all(jobs)) {
    if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 });
  }
}
