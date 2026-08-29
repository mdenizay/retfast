export function fmtDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function fmtTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(locale, { timeStyle: "medium" });
}

export function fmtDistance(m: number): string {
  if (!Number.isFinite(m)) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function fmtSpeed(mps: number | null | undefined): string {
  if (mps == null) return "—";
  return `${Math.round(mps * 3.6)} km/h`;
}

export function fmtAltitude(m: number | null | undefined): string {
  if (m == null) return "—";
  return `${Math.round(m)} m`;
}

/** Elapsed time between two instants as `1s 04d` style `H:MM`. */
export function fmtDuration(fromIso: string | null | undefined, toIso?: string | null): string {
  if (!fromIso) return "—";
  const end = toIso ? Date.parse(toIso) : Date.now();
  const s = Math.max(0, (end - Date.parse(fromIso)) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}s ${String(m).padStart(2, "0")}d` : `${m}d`;
}

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** 137° → "SE" (8-point compass). */
export function cardinal(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return "—";
  return CARDINALS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

export function fmtHeading(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return "—";
  return `${Math.round(((deg % 360) + 360) % 360)}° ${cardinal(deg)}`;
}

export function fmtAccuracy(m: number | null | undefined): string {
  if (m == null || m < 0) return "—";
  return `±${Math.round(m)} m`;
}

/** Seconds since a timestamp, or null when absent. */
export function ageSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
}

export function fmtAgo(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (s < 60) return rtf.format(-Math.round(s), "second");
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  return rtf.format(-Math.round(s / 86400), "day");
}
