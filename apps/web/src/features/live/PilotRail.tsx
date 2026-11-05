import { useMemo, useRef, useState } from "react";
import { Car, CheckCircle2, CircleDashed, MapPin, Navigation2, PlaneLanding, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmtAge, fmtAltitude, fmtDistance, fmtSpeed, fmtTime } from "@/lib/format";
import { SimBadge } from "@/components/status";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PHASE_ORDER, retrieverDistanceM, secondsSince, statusSince, type PilotPhase, type PilotRow } from "./derive";
import type { CardContext } from "./RetrievalBoard";

export type RailFilter = "all" | PilotPhase | "signal" | "sim";

const HEADER_H = 32;
const ROW_H = 60;

const PHASE_ICON: Record<PilotPhase, typeof MapPin> = {
  awaiting: MapPin,
  in_air: Navigation2,
  landed: PlaneLanding,
  retrieved: CheckCircle2,
  not_started: CircleDashed,
};

const PHASE_TONE: Record<PilotPhase, string> = {
  awaiting: "text-retrieval",
  in_air: "text-live",
  landed: "text-fg-secondary",
  retrieved: "text-success",
  not_started: "text-fg-muted",
};

type Item = { kind: "header"; phase: PilotPhase; n: number } | { kind: "row"; row: PilotRow };

export function PilotRail({
  rows, ctx, selectedUserId, onSelect, loading, showPhases,
}: {
  rows: PilotRow[];
  ctx: CardContext;
  selectedUserId: string | null;
  onSelect: (row: PilotRow) => void;
  loading: boolean;
  /** Group by phase (operations room). Off for the public / pilot map, where only flights are known. */
  showPhases: boolean;
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RailFilter>("all");

  const counts = useMemo(() => {
    const c: Record<RailFilter, number> = { all: rows.length, awaiting: 0, in_air: 0, landed: 0, retrieved: 0, not_started: 0, signal: 0, sim: 0 };
    for (const r of rows) {
      c[r.phase] += 1;
      if (r.live && r.live.status === "recording" && r.live.freshness !== "live") c.signal += 1;
      if (r.live?.isSimulated || r.retrieval?.is_simulated) c.sim += 1;
    }
    return c;
  }, [rows]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLocaleLowerCase(locale);
    const match = (r: PilotRow) => {
      if (filter === "signal" && !(r.live && r.live.status === "recording" && r.live.freshness !== "live")) return false;
      if (filter === "sim" && !(r.live?.isSimulated || r.retrieval?.is_simulated)) return false;
      if (filter !== "all" && filter !== "signal" && filter !== "sim" && r.phase !== filter) return false;
      return !q || r.name.toLocaleLowerCase(locale).includes(q) || (r.publicId ?? "").toLocaleLowerCase(locale).includes(q);
    };
    const fresh = { live: 0, stale: 1, lost: 2 } as const;
    const sorter = (a: PilotRow, b: PilotRow) => {
      if (a.phase === "awaiting" && b.phase === "awaiting") return Date.parse(a.retrieval!.requested_at) - Date.parse(b.retrieval!.requested_at);
      const fa = a.live ? fresh[a.live.freshness] : 3;
      const fb = b.live ? fresh[b.live.freshness] : 3;
      return fa - fb || a.name.localeCompare(b.name, locale);
    };
    const out: Item[] = [];
    if (!showPhases) {
      for (const r of rows.filter(match).sort(sorter)) out.push({ kind: "row", row: r });
      return out;
    }
    for (const phase of PHASE_ORDER) {
      const group = rows.filter((r) => r.phase === phase && match(r)).sort(sorter);
      if (group.length === 0) continue;
      out.push({ kind: "header", phase, n: group.length });
      for (const r of group) out.push({ kind: "row", row: r });
    }
    return out;
  }, [rows, query, filter, locale, showPhases]);

  // Variable-height windowing (headers 32 px, rows 60 px) keeps 2000+ pilots cheap.
  const offsets = useMemo(() => {
    const o: number[] = [];
    let y = 0;
    for (const it of items) {
      o.push(y);
      y += it.kind === "header" ? HEADER_H : ROW_H;
    }
    o.push(y);
    return o;
  }, [items]);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const total = offsets[offsets.length - 1] ?? 0;
  let start = 0;
  let lo = 0, hi = items.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid]! <= scrollTop) { start = mid; lo = mid + 1; } else hi = mid - 1;
  }
  start = Math.max(0, start - 8);
  let end = start;
  while (end < items.length && offsets[end]! < scrollTop + viewH + ROW_H * 8) end++;

  const filters: { id: RailFilter; label: string; show: boolean }[] = [
    { id: "all", label: t("live.filter.all"), show: true },
    { id: "awaiting", label: t("phase.awaiting"), show: showPhases },
    { id: "in_air", label: t("phase.in_air"), show: true },
    { id: "landed", label: t("phase.landed"), show: true },
    { id: "retrieved", label: t("phase.retrieved"), show: showPhases },
    { id: "not_started", label: t("phase.not_started"), show: showPhases },
    { id: "signal", label: t("live.filter.signal"), show: true },
    { id: "sim", label: "SIM", show: counts.sim > 0 },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("live.search")} aria-label={t("live.search")} className="h-11 rounded-full pl-11" />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("live.filters")}>
          {filters.filter((f) => f.show).map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-full px-2 text-caption font-medium tnum transition-colors",
                filter === f.id ? "bg-primary text-on-primary" : "bg-muted text-fg-secondary hover:text-fg",
              )}
            >
              {f.label}
              <span className="opacity-70">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>
      <div
        ref={(el) => {
          scroller.current = el;
          if (el && el.clientHeight && el.clientHeight !== viewH) setViewH(el.clientHeight);
        }}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {items.length === 0 ? (
          <div className="p-6 text-center text-footnote text-fg-muted">
            {loading ? t("common.loading") : rows.length === 0 ? t("live.empty.title") : t("live.noMatch")}
          </div>
        ) : (
          <ul style={{ height: total, position: "relative" }} aria-label={t("live.pilots")}>
            {items.slice(start, end).map((it, i) => {
              const idx = start + i;
              const top = offsets[idx]!;
              if (it.kind === "header") {
                const Icon = PHASE_ICON[it.phase];
                return (
                  <li key={`h-${it.phase}`} role="presentation" style={{ position: "absolute", top, left: 0, right: 0, height: HEADER_H }}
                    className="flex items-end gap-1.5 px-4 pb-1.5 text-footnote font-semibold text-fg">
                    <Icon className={cn("size-3.5", PHASE_TONE[it.phase])} aria-hidden />
                    {t(`phase.${it.phase}`)} <span className="tnum text-fg-muted">{it.n}</span>
                  </li>
                );
              }
              return (
                <li key={it.row.key} className="px-2 py-0.5" style={{ position: "absolute", top, left: 0, right: 0, height: ROW_H }}>
                  <RailRow row={it.row} ctx={ctx} selected={it.row.userId === selectedUserId} onSelect={onSelect} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function RailRow({ row, ctx, selected, onSelect }: { row: PilotRow; ctx: CardContext; selected: boolean; onSelect: (r: PilotRow) => void }) {
  const { t, lang, locale } = useI18n();
  const p = row.live;
  const r = row.retrieval;
  let line: React.ReactNode;
  if (row.phase === "awaiting" && r) {
    const s = secondsSince(statusSince(r), ctx.nowMs, ctx.clockOffsetMs);
    const d = retrieverDistanceM(r, ctx.retrievers);
    line = (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-retrieval">{t(`retrieval.age.${r.status as "requested" | "accepted" | "picked_up"}`, { age: fmtAge(s, lang) })}</span>
        {r.retriever && <span className="inline-flex min-w-0 items-center gap-1 truncate"><Car className="size-3 shrink-0" aria-hidden />{r.retriever.full_name}{d !== null && r.status === "accepted" ? ` · ${fmtDistance(d, locale)}` : ""}</span>}
      </span>
    );
  } else if (row.phase === "in_air" && p) {
    line = <span className="telemetry flex gap-2"><span>{fmtAltitude(p.position.gps_alt_m, locale)}</span><span>{fmtSpeed(p.position.speed_ms, locale)}</span></span>;
  } else if (row.phase === "retrieved" && r) {
    line = <span>{t("retrieval.at.delivered", { time: fmtTime(statusSince(r), locale, false) })}</span>;
  } else if (row.phase === "landed") {
    line = <span>{r?.status === "cancelled" ? t("rail.cancelled") : p ? t("rail.landedAt", { time: fmtTime(p.position.t, locale, false) }) : t("phase.landed")}</span>;
  } else {
    line = <span>{t("rail.notStarted")}</span>;
  }
  const Glyph = row.phase === "in_air" && p ? null : PHASE_ICON[row.phase];
  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex h-full w-full items-center gap-3 rounded-2xl px-2.5 text-left transition-colors",
        selected ? "bg-brand/12" : "hover:bg-muted",
      )}
    >
      {Glyph ? (
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted" aria-hidden><Glyph className={cn("size-5", PHASE_TONE[row.phase])} /></span>
      ) : (
        <FreshGlyph freshness={p!.freshness} heading={p!.position.course_deg} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-body font-medium">{row.name}</span>
          {(p?.isSimulated || r?.is_simulated) && <SimBadge className="py-0" />}
        </div>
        <div className="truncate text-caption text-fg-muted">{line}</div>
      </div>
      {p && p.status === "recording" && (
        <div className="shrink-0 text-right">
          <div className={cn("text-caption font-medium", p.freshness === "live" ? "text-live" : p.freshness === "stale" ? "text-stale" : "text-offline")}>
            {t(`fresh.${p.freshness}`)}
          </div>
          <div className="telemetry text-caption text-fg-muted">{fmtAge(p.ageS, lang)}</div>
        </div>
      )}
    </button>
  );
}

export function FreshGlyph({ freshness, heading }: { freshness: "live" | "stale" | "lost"; heading: number | null }) {
  const cls = freshness === "live" ? "text-live fill-live" : freshness === "stale" ? "text-stale fill-transparent" : "text-offline fill-transparent";
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted" aria-hidden>
      <Navigation2
        className={cn("size-5", cls, freshness === "lost" && "[stroke-dasharray:3_2]")}
        style={{ transform: `rotate(${heading ?? 0}deg)` }}
        strokeWidth={2}
      />
    </span>
  );
}
