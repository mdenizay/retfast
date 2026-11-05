import { useI18n } from "@/lib/i18n";
import { fmtAge, fmtTime } from "@/lib/format";
import type { Retrieval } from "@/lib/api/types";
import { secondsSince, statusSince } from "./derive";

/** A request waiting longer than this gets an explicit "long wait" label (icon + text, not just color). */
export const LONG_WAIT_S = 15 * 60;

/** One-line age phrase per status: "12 dk bekliyor", "kabul 4 dk", "teslim 14:32". */
export function useAgePhrase() {
  const { t, lang, locale } = useI18n();
  return (r: Retrieval, ctx: { nowMs: number; clockOffsetMs: number }) => {
    const since = statusSince(r);
    const s = secondsSince(since, ctx.nowMs, ctx.clockOffsetMs);
    if (r.status === "delivered" || r.status === "cancelled") return t(`retrieval.at.${r.status}`, { time: fmtTime(since, locale, false) });
    return t(`retrieval.age.${r.status}`, { age: fmtAge(s, lang) });
  };
}
