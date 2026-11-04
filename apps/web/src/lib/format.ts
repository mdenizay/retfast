/** Number/time formatting for telemetry. All functions are pure; `locale` is a BCP-47 tag. */
export type Units = "metric" | "imperial";

const nf = (locale: string, max = 0, min = 0) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: max, minimumFractionDigits: min });

export function fmtNumber(v: number | null | undefined, locale: string, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return nf(locale, digits, digits).format(v);
}

export function fmtAltitude(m: number | null | undefined, locale: string, units: Units = "metric"): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return "—";
  return units === "imperial" ? `${nf(locale).format(m * 3.28084)} ft` : `${nf(locale).format(m)} m`;
}

export function fmtSpeed(ms: number | null | undefined, locale: string, units: Units = "metric"): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  return units === "imperial" ? `${nf(locale).format(ms * 2.23694)} mph` : `${nf(locale).format(ms * 3.6)} km/h`;
}

export function fmtVario(ms: number | null | undefined, locale: string): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const sign = ms > 0.05 ? "+" : ms < -0.05 ? "−" : "±";
  return `${sign}${nf(locale, 1, 1).format(Math.abs(ms))} m/s`;
}

export function fmtDistance(m: number | null | undefined, locale: string, units: Units = "metric"): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return "—";
  if (units === "imperial") return `${nf(locale, 1, 1).format(m / 1609.344)} mi`;
  return m < 1000 ? `${nf(locale).format(m)} m` : `${nf(locale, 1, 1).format(m / 1000)} km`;
}

export function fmtHeading(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return "—";
  return `${String(Math.round(((deg % 360) + 360) % 360)).padStart(3, "0")}°`;
}

export function fmtAccuracy(m: number | null | undefined, locale: string): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return "—";
  return `±${nf(locale).format(m)} m`;
}

/** Compact age: 8 sn · 3 dk 05 sn · 2 sa 04 dk (TR) / 8 s · 3 min 05 s · 2 h 04 min (EN). */
export function fmtAge(seconds: number | null | undefined, lang: "tr" | "en"): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const u = lang === "tr" ? { s: "sn", m: "dk", h: "sa", d: "g" } : { s: "s", m: "min", h: "h", d: "d" };
  if (s < 60) return `${s} ${u.s}`;
  if (s < 3600) return `${Math.floor(s / 60)} ${u.m} ${String(s % 60).padStart(2, "0")} ${u.s}`;
  if (s < 86400) return `${Math.floor(s / 3600)} ${u.h} ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} ${u.m}`;
  return `${Math.floor(s / 86400)} ${u.d} ${Math.floor((s % 86400) / 3600)} ${u.h}`;
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function fmtDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export function fmtDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
}

export function fmtTime(iso: string | number | null | undefined, locale: string, seconds = true): string {
  if (iso === null || iso === undefined) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: seconds ? "2-digit" : undefined }).format(d);
}

export function fmtCoord(lat: number | null | undefined, lon: number | null | undefined): string {
  if (lat == null || lon == null) return "—";
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function fmtPercent(ratio: number | null | undefined, locale: string): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(ratio);
}

/** datetime-local input value (local time) <-> ISO. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
