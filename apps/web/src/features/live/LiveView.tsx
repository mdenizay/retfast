import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Car, Columns3, Crosshair, Map as MapIcon, MapPin, Navigation2, Users, WifiOff, X } from "lucide-react";
import type { Member, RfEvent } from "@/lib/api/types";
import { eventsApi, retrievalsApi } from "@/lib/api/endpoints";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/auth";
import { fmtAge, fmtCoord, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MapCanvas } from "@/components/map/MapCanvas";
import { ConnectionIndicator, FreshnessBadge } from "@/components/status";
import { ErrorState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useLiveEvent } from "./useLiveEvent";
import { LiveMapLayers, type MapSelection } from "./LiveMapLayers";
import { distanceM, isOpen, pilotPoint, pilotRows, visibleRetrievals, type PilotRow, type Viewer } from "./derive";
import { PilotRail } from "./PilotRail";
import { PilotDetail } from "./PilotDetail";
import { RetrievalBoard, RetrievalQueue, type CardContext } from "./RetrievalBoard";
import { RetrievalDetail, type AssignCandidate } from "./RetrievalDetail";
import { useRetrievalAction } from "./useRetrievalAction";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { RetrieverView } from "./store";

export type LiveMode = "public" | "ops" | "pilot";

interface Props {
  event: RfEvent;
  mode: LiveMode;
  /** Organizer / admin: may assign, cancel and annotate retrievals. */
  canManage?: boolean;
  backHref: string;
}

export function LiveView({ event, mode, canManage = false, backHref }: Props) {
  const { t, locale } = useI18n();
  const { user } = useSession();
  const ops = mode === "ops";
  // Mount each panel once (desktop column or bottom sheet), not both with CSS hiding.
  const isLg = useMediaQuery("(min-width: 1024px)");
  const isXl = useMediaQuery("(min-width: 1280px)");
  const live = useLiveEvent(event.id, { pilots: true, retrievals: mode !== "public" });
  const members = useQuery({
    queryKey: ["app", "members", event.id],
    queryFn: () => eventsApi.members(event.id),
    enabled: ops,
    staleTime: 60_000,
    retry: false,
  });
  const actions = useRetrievalAction(live.store);
  const [params, setParams] = useSearchParams();
  const view = ops && params.get("view") === "board" ? "board" : "map";
  const setView = (v: "map" | "board") => {
    const next = new URLSearchParams(params);
    if (v === "board") next.set("view", "board");
    else next.delete("view");
    setParams(next, { replace: true });
  };

  const [selection, setSelection] = useState<MapSelection>(null);
  const [follow, setFollow] = useState(false);
  const [centerRequest, setCenterRequest] = useState(0);
  const [centerOn, setCenterOn] = useState<{ lat: number; lon: number } | null>(null);
  const [mobileTab, setMobileTab] = useState<"list" | "queue" | "detail">("list");
  const [sheetOpen, setSheetOpen] = useState(false);

  const viewer: Viewer = ops ? { kind: "operator" } : { kind: "pilot", userId: user?.id ?? "" };
  const retrievals = useMemo(() => (mode === "public" ? [] : visibleRetrievals(live.retrievals, viewer)), [live.retrievals, mode, viewer.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const memberList: Member[] | null = ops ? (members.data ?? null) : null;
  const rows = useMemo(() => pilotRows(live.pilots, retrievals, memberList), [live.pilots, retrievals, memberList]);
  const ctx: CardContext = { nowMs: live.now, clockOffsetMs: live.state.clockOffsetMs, retrievers: live.retrievers };

  const counts = useMemo(() => {
    const c = { in_air: 0, requested: 0, open: 0, onDuty: 0 };
    for (const r of rows) if (r.phase === "in_air") c.in_air += 1;
    for (const r of retrievals) {
      if (r.status === "requested") c.requested += 1;
      if (isOpen(r)) c.open += 1;
    }
    for (const r of live.retrievers) if (r.onDuty) c.onDuty += 1;
    return c;
  }, [rows, retrievals, live.retrievers]);

  const select = useCallback((sel: MapSelection) => {
    setSelection(sel);
    if (sel) {
      setMobileTab("detail");
      setSheetOpen(true);
    } else setFollow(false);
  }, []);
  const selectRow = (row: PilotRow) => select({ kind: "pilot", userId: row.userId, flightId: row.live?.flightId ?? null });
  const selectRetrieval = (id: string) => select({ kind: "retrieval", id });

  const selRow = selection?.kind === "pilot" ? rows.find((r) => r.userId === selection.userId) ?? null : null;
  const selRetrieval = selection?.kind === "retrieval" ? retrievals.find((r) => r.id === selection.id) ?? null : null;
  const selRetriever = selection?.kind === "retriever" ? live.retrievers.find((r) => r.userId === selection.userId) ?? null : null;

  const canSeeTrack = selRetriever != null && (mode === "ops" || selRetriever.userId === user?.id);
  const trackQ = useQuery({
    queryKey: ["retriever-track", event.id, selRetriever?.userId],
    queryFn: ({ signal }) => retrievalsApi.retrieverTrack(event.id, selRetriever!.userId, 180, signal),
    enabled: canSeeTrack,
    refetchInterval: 30_000,
    retry: false,
  });
  const retrieverTrack = useMemo(
    () => (canSeeTrack ? trackQ.data?.map((p) => [p.lon, p.lat] as [number, number]) : undefined),
    [canSeeTrack, trackQ.data],
  );

  const centerPoint = (p: { lat: number; lon: number }) => {
    setCenterOn(p);
    if (view === "board") setView("map");
    setCenterRequest((n) => n + 1);
  };

  const candidates: AssignCandidate[] = useMemo(() => {
    const out = new Map<string, AssignCandidate>();
    const target = selRetrieval ? pilotPoint(selRetrieval) : null;
    for (const r of live.retrievers) {
      out.set(r.userId, {
        userId: r.userId, fullName: r.fullName, onDuty: r.onDuty, active: r.activeRetrievals,
        distanceM: target && r.position ? distanceM(r.position, target) : null,
      });
    }
    for (const m of memberList ?? []) {
      if (m.role === "retriever" && m.status === "active" && !out.has(m.user_id)) {
        out.set(m.user_id, { userId: m.user_id, fullName: m.full_name, onDuty: null, active: null, distanceM: null });
      }
    }
    return [...out.values()].sort((a, b) =>
      Number(b.onDuty === true) - Number(a.onDuty === true) || (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) || a.fullName.localeCompare(b.fullName, locale),
    );
  }, [live.retrievers, memberList, selRetrieval, locale]);

  const flightHref = (row: PilotRow) => (row.live ? (mode === "public" ? `/flights/${row.live.flightId}` : `/app/flights/${row.live.flightId}`) : null);

  const detail: ReactNode = selRetrieval ? (
    <RetrievalDetail
      key={selRetrieval.id}
      r={selRetrieval}
      ctx={ctx}
      canManage={canManage}
      actions={actions}
      candidates={candidates}
      onCenter={() => centerPoint(pilotPoint(selRetrieval))}
      onClose={() => select(null)}
    />
  ) : selRow ? (
    <PilotDetail
      row={selRow}
      ctx={ctx}
      flightHref={flightHref(selRow)}
      follow={follow}
      onFollow={() => setFollow((f) => !f)}
      onCenter={() => {
        const p = selRow.live?.position ?? (selRow.retrieval ? pilotPoint(selRow.retrieval) : null);
        if (p) centerPoint(p);
      }}
      onClose={() => select(null)}
      onOpenRetrieval={ops ? selectRetrieval : undefined}
    />
  ) : selRetriever ? (
    <RetrieverDetail r={selRetriever} retrievals={retrievals} onClose={() => select(null)} onCenter={() => selRetriever.position && centerPoint(selRetriever.position)} onSelectRetrieval={selectRetrieval} />
  ) : null;

  const sidePanel: ReactNode = detail ?? (ops ? (
    <RetrievalQueue retrievals={retrievals} ctx={ctx} onSelect={selectRetrieval} known={live.state.retrievalsKnown} />
  ) : (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-footnote text-fg-muted">
      <Crosshair className="size-6" aria-hidden />
      {t("live.selectPilot")}
    </div>
  ));

  const rail = (
    <PilotRail
      rows={rows}
      ctx={ctx}
      selectedUserId={selection?.kind === "pilot" ? selection.userId : selRetrieval?.pilot.user_id ?? null}
      onSelect={selectRow}
      loading={live.isLoading}
      showPhases={ops}
    />
  );

  const disconnected = live.connection === "reconnecting";
  const hasAnything = live.pilots.length > 0 || retrievals.length > 0;

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 sm:px-4">
        <Button asChild variant="ghost" size="icon-sm" aria-label={t("common.back")}>
          <Link to={backHref}><ArrowLeft /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-headline font-semibold">{event.name}</h1>
            {event.is_demo && <span className="rounded-[6px] border border-secondary/60 px-1.5 text-caption font-medium text-secondary">DEMO</span>}
            {ops && <span className="hidden rounded-[6px] border border-border px-1.5 text-caption text-fg-muted sm:inline">{canManage ? t("live.modeOrganizer") : t("live.modeObserver")}</span>}
          </div>
          <div className="hidden truncate text-caption text-fg-muted sm:block">{event.location_name} · {t(`event.status.${event.status}`)}</div>
        </div>
        <dl className="hidden items-center gap-5 text-footnote md:flex" aria-label={t("live.counts")}>
          <Kpi Icon={Navigation2} tone="text-live" label={t("kpi.inAir")} value={counts.in_air} />
          {mode !== "public" && <Kpi Icon={MapPin} tone="text-retrieval" label={t("kpi.requested")} value={counts.requested} />}
          {ops && <Kpi Icon={Car} tone="text-secondary" label={t("kpi.onDuty")} value={counts.onDuty} />}
        </dl>
        {ops && (
          <div className="flex overflow-hidden rounded-sm border border-border" role="group" aria-label={t("live.viewLabel")}>
            <ViewBtn active={view === "map"} onClick={() => setView("map")} Icon={MapIcon} label={t("live.viewMap")} />
            <ViewBtn active={view === "board"} onClick={() => setView("board")} Icon={Columns3} label={t("live.viewBoard")} badge={counts.open} />
          </div>
        )}
        <div className="flex flex-col items-end">
          <ConnectionIndicator status={live.connection} attempt={live.reconnectAttempt} />
          {live.lastSnapshotAt && (
            <span className="hidden text-caption text-fg-muted sm:block telemetry">{t("live.snapshotAt", { time: fmtTime(live.lastSnapshotAt, locale) })}</span>
          )}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {isLg && view === "map" && <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-surface" aria-label={t("live.pilots")}>{rail}</aside>}

        <main className="relative min-w-0 flex-1">
          {view === "board" ? (
            <RetrievalBoard
              retrievals={retrievals}
              ctx={ctx}
              selectedId={selRetrieval?.id ?? null}
              onSelect={selectRetrieval}
              known={live.state.retrievalsKnown}
            />
          ) : (
            <MapCanvas
              label={t("live.mapLabel", { name: event.name })}
              initialCenter={event.center ? [event.center.lon, event.center.lat] : undefined}
              initialZoom={event.center ? 11 : 5}
            >
              {(ready) => (
                <LiveMapLayers
                  {...ready}
                  pilots={live.pilots}
                  retrievals={retrievals}
                  retrievers={live.retrievers}
                  retrieverTrack={retrieverTrack}
                  selection={selection}
                  follow={follow}
                  centerRequest={centerRequest}
                  centerOn={centerOn}
                  fallbackCenter={event.center}
                  nowMs={live.now}
                  clockOffsetMs={live.state.clockOffsetMs}
                  onSelect={select}
                />
              )}
            </MapCanvas>
          )}

          {disconnected && (
            <div role="status" aria-live="polite" className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border border-stale/60 bg-surface px-3 py-2 text-footnote text-fg shadow-[0_2px_8px_rgb(0_0_0/0.12)]">
              <WifiOff className="size-4 text-stale" aria-hidden />
              {t("conn.reconnecting", { n: live.reconnectAttempt })}
            </div>
          )}
          {live.snapshotError != null && (
            <div className="absolute top-16 left-1/2 z-10 w-[min(92%,28rem)] -translate-x-1/2">
              <ErrorState error={live.snapshotError} onRetry={() => void live.refetch()} className="bg-surface" />
            </div>
          )}
          {view === "map" && !live.isLoading && !hasAnything && live.snapshotError == null && (
            <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center px-4">
              <div className="pointer-events-auto max-w-sm rounded-md border border-border bg-surface px-4 py-3 text-center text-footnote text-fg-secondary">
                <div className="font-medium text-fg">{t("live.empty.title")}</div>
                <div>{mode === "public" ? t("live.empty.public") : mode === "pilot" ? t("live.empty.pilot") : t("live.empty.app")}</div>
              </div>
            </div>
          )}

          <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
            {!sheetOpen && !isLg && (
              <Button variant="outline" onClick={() => { setMobileTab("list"); setSheetOpen(true); }} className="shadow-[0_2px_8px_rgb(0_0_0/0.12)]">
                <Users /> {t("live.pilots")} · <span className="tnum">{rows.length}</span>
              </Button>
            )}
          </div>
          {ops && !sheetOpen && !isXl && (
            <div className="absolute right-4 bottom-4 z-10">
              <Button variant="outline" onClick={() => { setMobileTab(detail ? "detail" : "queue"); setSheetOpen(true); }} className="shadow-[0_2px_8px_rgb(0_0_0/0.12)]">
                <MapPin className="text-retrieval" /> <span className="tnum">{counts.open}</span><span className="sr-only">{t("queue.title")}</span>
              </Button>
            </div>
          )}
        </main>

        {isXl && (view === "map" || detail) && (
          <aside className="flex w-[22rem] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface" aria-label={t("live.detail")}>
            {sidePanel}
          </aside>
        )}

        {sheetOpen && !isXl && (
          <div className="absolute inset-x-0 bottom-0 z-20 flex max-h-[66dvh] min-h-[40dvh] flex-col rounded-t-xl border-t border-border bg-surface">
            <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
              <div role="tablist" className="flex flex-1 gap-1">
                {!isLg && <SheetTab active={mobileTab === "list"} onClick={() => setMobileTab("list")}>{t("live.pilots")}</SheetTab>}
                {ops && <SheetTab active={mobileTab === "queue"} onClick={() => setMobileTab("queue")}>{t("queue.title")}</SheetTab>}
                <SheetTab active={mobileTab === "detail"} onClick={() => setMobileTab("detail")}>{t("live.detail")}</SheetTab>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={t("common.close")} onClick={() => setSheetOpen(false)}><X /></Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {mobileTab === "list" && !isLg && <div className="flex min-h-0 flex-1 flex-col">{rail}</div>}
              {mobileTab === "queue" && ops && <RetrievalQueue retrievals={retrievals} ctx={ctx} onSelect={selectRetrieval} known={live.state.retrievalsKnown} />}
              {mobileTab === "detail" && (detail ?? <p className="p-6 text-center text-footnote text-fg-muted">{t("live.selectPilot")}</p>)}
            </div>
          </div>
        )}
      </div>
      <span className="sr-only" aria-live="polite">{counts.requested > 0 ? t("live.srRequested", { n: counts.requested }) : ""}</span>
    </div>
  );
}

function Kpi({ Icon, tone, label, value }: { Icon: typeof MapPin; tone: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn("size-4", tone)} aria-hidden />
      <dt className="text-fg-secondary">{label}</dt>
      <dd className="telemetry font-semibold text-fg">{value}</dd>
    </div>
  );
}

function ViewBtn({ active, onClick, Icon, label, badge }: { active: boolean; onClick: () => void; Icon: typeof MapPin; label: string; badge?: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn("inline-flex h-9 items-center gap-1.5 px-3 text-footnote font-medium", active ? "bg-fg text-background" : "bg-surface text-fg-secondary hover:bg-accent")}
    >
      <Icon className="size-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
      {badge ? <span className="tnum opacity-80">{badge}</span> : null}
    </button>
  );
}

function SheetTab({ active, onClick, children, className }: { active: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn("h-10 flex-1 rounded-sm text-footnote font-medium", active ? "bg-accent text-fg" : "text-fg-muted hover:text-fg", className)}
    >
      {children}
    </button>
  );
}

function RetrieverDetail({
  r, retrievals, onClose, onCenter, onSelectRetrieval,
}: {
  r: RetrieverView;
  retrievals: ReturnType<typeof visibleRetrievals>;
  onClose: () => void;
  onCenter: () => void;
  onSelectRetrieval: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const holding = retrievals.filter((x) => x.retriever?.user_id === r.userId && isOpen(x));
  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-2 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <div className="text-caption text-fg-muted">{t("role.retriever")}</div>
          <div className="truncate text-headline font-semibold">{r.fullName}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {r.freshness && <FreshnessBadge freshness={r.freshness} />}
            <span className="text-caption text-fg-secondary">{r.onDuty ? t("rdetail.onDuty") : t("rdetail.offDuty")}</span>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("live.deselect")}><X /></Button>
      </div>
      <div className="border-b border-border p-4 text-footnote">
        {r.position ? (
          <>
            <div className="telemetry select-all">{fmtCoord(r.position.lat, r.position.lon)}</div>
            <div className="text-caption text-fg-muted">{t("rdetail.positionAge", { age: fmtAge(r.ageS, lang) })}</div>
          </>
        ) : <span className="text-fg-muted">{t("rdetail.noRetrieverPos")}</span>}
      </div>
      <div className="p-4">
        <h3 className="mb-2 text-caption font-semibold tracking-wide text-fg-secondary uppercase">{t("rdetail.holding", { n: holding.length })}</h3>
        <ul className="space-y-1">
          {holding.map((x) => (
            <li key={x.id}>
              <button type="button" className="text-footnote text-fg underline decoration-fg/25 underline-offset-4 transition-colors hover:decoration-fg" onClick={() => onSelectRetrieval(x.id)}>
                {x.pilot.full_name} · {t(`retrieval.status.${x.status}`)}
              </button>
            </li>
          ))}
        </ul>
        {r.position && <Button variant="outline" className="mt-3 w-full" onClick={onCenter}><Crosshair /> {t("live.center")}</Button>}
      </div>
    </div>
  );
}
