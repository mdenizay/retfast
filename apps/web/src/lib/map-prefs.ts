"use client";
import { useSyncExternalStore } from "react";
import type { BasemapId } from "./basemaps";

export type MapPrefs = { basemap: BasemapId | null; threeD: boolean };

const KEY = "rf_map";
const SERVER: MapPrefs = { basemap: null, threeD: false };
let prefs: MapPrefs = SERVER;
let loaded = false;
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<MapPrefs> | null;
    if (v) prefs = { basemap: (["dark", "light", "city", "satellite"] as const).find((b) => b === v.basemap) ?? null, threeD: !!v.threeD };
  } catch {
    /* depolama kapalı */
  }
}

export function setMapPrefs(p: Partial<MapPrefs>) {
  load();
  prefs = { ...prefs, ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* depolama kapalı */
  }
  subs.forEach((f) => f());
}

export function useMapPrefs(): MapPrefs {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => {
      load();
      return prefs;
    },
    () => SERVER,
  );
}

/** Kullanıcı seçmediyse alt harita temayı izler. */
export function resolveBasemap(p: MapPrefs, theme: "light" | "dark"): BasemapId {
  return p.basemap ?? (theme === "dark" ? "dark" : "light");
}
