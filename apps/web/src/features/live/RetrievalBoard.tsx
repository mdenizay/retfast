import { Car, Hourglass, MessageSquareText } from "lucide-react";
import type { Retrieval, RetrievalStatus } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n";
import { fmtDistance } from "@/lib/format";
import { SimBadge } from "@/components/status";
import { RETRIEVAL_ICON } from "@/components/stateIcons";
import { cn } from "@/lib/utils";
import { BOARD_COLUMNS, boardColumns, retrieverDistanceM, secondsSince, statusSince } from "./derive";
import { LONG_WAIT_S, useAgePhrase } from "./useAgePhrase";
import type { RetrieverView } from "./store";


export interface CardContext {
  nowMs: number;
  clockOffsetMs: number;
  retrievers: RetrieverView[];
}

const COLUMN_TONE: Record<RetrievalStatus, string> = {
  requested: "text-retrieval",
  accepted: "text-secondary",
  picked_up: "text-primary",
  delivered: "text-success",
  cancelled: "text-fg-muted",
};


export function RetrievalCard({
  r, ctx, selected, onSelect, compact,
}: {
  r: Retrieval;
  ctx: CardContext;
  selected?: boolean;
  onSelect?: (id: string) => void;
  compact?: boolean;
}) {
  const { t, locale } = useI18n();
  const phrase = useAgePhrase();
  const wait = r.status === "requested" ? secondsSince(statusSince(r), ctx.nowMs, ctx.clockOffsetMs) : null;
  const long = wait !== null && wait >= LONG_WAIT_S;
  const dist = retrieverDistanceM(r, ctx.retrievers);
  const Icon = RETRIEVAL_ICON[r.status];
  return (
    <button
      type="button"
      onClick={() => onSelect?.(r.id)}
      aria-current={selected ? "true" : undefined}
      data-retrieval={r.id}
      className={cn(
        "w-full rounded-md border bg-surface text-left transition-colors hover:bg-accent",
        compact ? "px-3 py-2.5" : "p-3",
        selected ? "border-fg ring-1 ring-fg" : long ? "border-warning/60" : "border-border",
        (r.status === "delivered" || r.status === "cancelled") && "opacity-85",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4 shrink-0", COLUMN_TONE[r.status])} aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium">{r.pilot.full_name}</span>
        {r.is_simulated && <SimBadge className="py-0" />}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-footnote tnum">
        <span className={cn(long ? "font-medium text-warning" : "text-fg-secondary")}>{phrase(r, ctx)}</span>
        {long && (
          <span className="inline-flex items-center gap-0.5 rounded-[6px] border border-warning/50 px-1 text-caption font-medium text-warning">
            <Hourglass className="size-3" aria-hidden />{t("retrieval.longWait")}
          </span>
        )}
      </div>
      {r.retriever && (
        <div className="mt-1 flex items-center gap-1.5 text-caption text-fg-secondary">
          <Car className="size-3.5 text-secondary" aria-hidden />
          <span className="truncate">{r.retriever.full_name}</span>
          {dist !== null && (r.status === "accepted") && <span className="telemetry text-fg-muted">· {t("retrieval.away", { d: fmtDistance(dist, locale) })}</span>}
        </div>
      )}
      {!compact && r.note && (
        <div className="mt-1.5 flex gap-1.5 text-caption text-fg-muted">
          <MessageSquareText className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span className="line-clamp-2">{r.note}</span>
        </div>
      )}
      {!compact && r.status === "cancelled" && r.cancel_reason && (
        <div className="mt-1 line-clamp-1 text-caption text-fg-muted">“{r.cancel_reason}”</div>
      )}
    </button>
  );
}

/** Full-width board: Requested · Accepted · Picked up · Delivered (recent) · Cancelled. */
export function RetrievalBoard({
  retrievals, ctx, selectedId, onSelect, known,
}: {
  retrievals: Retrieval[];
  ctx: CardContext;
  selectedId: string | null;
  onSelect: (id: string) => void;
  known: boolean;
}) {
  const { t } = useI18n();
  const cols = boardColumns(retrievals);
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-px overflow-auto bg-border sm:grid-cols-2 lg:grid-cols-5 lg:overflow-hidden" aria-label={t("board.label")}>
      {BOARD_COLUMNS.map((c) => {
        const Icon = RETRIEVAL_ICON[c];
        const items = cols[c];
        return (
          <section key={c} className="flex min-h-0 flex-col bg-background" aria-labelledby={`col-${c}`}>
            <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
              <Icon className={cn("size-4", COLUMN_TONE[c])} aria-hidden />
              <h2 id={`col-${c}`} className="flex-1 text-footnote font-semibold tracking-wide text-fg-secondary uppercase">{t(`board.col.${c}`)}</h2>
              <span className="telemetry text-footnote text-fg">{items.length}</span>
            </header>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2" aria-label={t(`board.col.${c}`)}>
              {items.length === 0 ? (
                <li className="px-1 py-4 text-center text-caption text-fg-muted">{known ? t("board.emptyCol") : t("common.loading")}</li>
              ) : (
                items.map((r) => (
                  <li key={r.id}><RetrievalCard r={r} ctx={ctx} selected={r.id === selectedId} onSelect={onSelect} /></li>
                ))
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Compact queue for the side panel (open requests only, grouped by status). */
export function RetrievalQueue({
  retrievals, ctx, onSelect, known,
}: {
  retrievals: Retrieval[];
  ctx: CardContext;
  onSelect: (id: string) => void;
  known: boolean;
}) {
  const { t } = useI18n();
  const cols = boardColumns(retrievals);
  const open = (["requested", "accepted", "picked_up"] as const).filter((c) => cols[c].length > 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-footnote font-semibold tracking-wide text-fg-secondary uppercase">{t("queue.title")}</h2>
        <p className="mt-0.5 text-caption text-fg-muted">{t("queue.hint")}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {open.length === 0 ? (
          <p className="py-6 text-center text-footnote text-fg-muted">{known ? t("queue.empty") : t("common.loading")}</p>
        ) : (
          open.map((c) => (
            <section key={c} className="mb-4">
              <h3 className="mb-1.5 text-caption font-medium text-fg-muted">{t(`board.col.${c}`)} · <span className="tnum">{cols[c].length}</span></h3>
              <ul className="space-y-1.5" aria-label={`${t("queue.title")}: ${t(`board.col.${c}`)}`}>
                {cols[c].map((r) => <li key={r.id}><RetrievalCard r={r} ctx={ctx} onSelect={onSelect} compact /></li>)}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
