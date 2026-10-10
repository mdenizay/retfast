"use client";
import Link from "next/link";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  connectLive, freshness, positionAge, shortAge, type ConnectionStatus, type EventDetail, type LiveMember, type LiveState,
  type MessageKey, type OpEvent, type PilotState, type Position, type Retrieve, type SosAlert,
} from "@retfast/core";
import { MapView, setEventFeatures } from "@/components/map";
import { Badge, Button, ErrorText, Pills, Select, Spinner, cx } from "@/components/ui";
import { api, errorCode, wsBase } from "@/lib/api";
import { formatDate, useI18n } from "@/lib/i18n";

const STATE_COLOR: Record<PilotState, string> = {
  preparing: "#7d8088",
  flying: "#6cc0ff",
  landed: "#f3c112",
  awaiting_retrieve: "#ff8a3d",
  retriever_assigned: "#b79cff",
  picked_up: "#45d483",
  completed: "#55585f",
};
const RETRIEVER_COLOR = "#f4f4f5";
// Detay paneli haritanın sağını kapatır; odaklanan nokta görünür alanın ortasına gelsin.
const PANEL_PADDING = { top: 120, bottom: 40, left: 400, right: 390 };

type Group = "sos" | "waiting" | "assigned" | "flying" | "landed" | "picked_up" | "lost" | "retrievers" | "preparing" | "done";
const GROUPS: Group[] = ["sos", "waiting", "assigned", "flying", "landed", "picked_up", "lost", "retrievers", "preparing", "done"];

function name(m: Pick<LiveMember, "first_name" | "last_name" | "bib">) {
  return `${m.bib ? `#${m.bib} ` : ""}${m.first_name} ${m.last_name}`;
}

function beep() {
  try {
    const ctx = new AudioContext();
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.3);
      o.stop(ctx.currentTime + i * 0.3 + 0.18);
    }
  } catch {
    /* ses izni yok */
  }
}

export function LiveConsole({ eventId }: { eventId: string }) {
  const { t, err, locale } = useI18n();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"ops" | "log">("ops");
  const [now, setNow] = useState(() => Date.now());
  const [track, setTrack] = useState<[number, number][] | null>(null);
  const [error, setError] = useState<string>();
  const map = useRef<MlMap | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    void api.events.get(eventId).then(setEv).catch((x) => setError(err(errorCode(x))));
    const stop = connectLive({
      client: api, eventId, wsBase: wsBase(), onState: setLive, onStatus: setStatus,
      onEvent: (e: OpEvent) => {
        if (e.t === "sos.raised") beep();
      },
    });
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      stop();
      clearInterval(tick);
    };
  }, [eventId, err]);

  const members = useMemo(() => new Map((live?.members ?? []).map((m) => [m.user_id, m])), [live?.members]);
  const sosBy = useMemo(() => new Map((live?.sos ?? []).map((s) => [s.user_id, s])), [live?.sos]);
  const retrieveByPilot = useMemo(() => new Map((live?.retrieves ?? []).map((r) => [r.pilot_id, r])), [live?.retrieves]);
  const stopsByRetriever = useMemo(() => {
    const m = new Map<string, Retrieve[]>();
    for (const r of live?.retrieves ?? []) if (r.retriever_id) m.set(r.retriever_id, [...(m.get(r.retriever_id) ?? []), r]);
    return m;
  }, [live?.retrieves]);

  const age = useCallback((p?: Position) => (p && live ? positionAge(p, live, now) : Infinity), [live, now]);

  const groupOf = useCallback(
    (m: LiveMember): Group | null => {
      if (sosBy.has(m.user_id)) return "sos";
      if (m.role === "retriever") return "retrievers";
      if (m.role !== "pilot") return null;
      const s = m.pilot_state ?? "preparing";
      const lost = m.tracking && freshness(age(live?.positions[m.user_id])) === "lost";
      if (s === "awaiting_retrieve") return "waiting";
      if (s === "retriever_assigned") return "assigned";
      if (lost && (s === "flying" || s === "landed")) return "lost";
      if (s === "flying") return "flying";
      if (s === "landed") return "landed";
      if (s === "picked_up") return "picked_up";
      if (s === "completed") return "done";
      return "preparing";
    },
    [sosBy, age, live?.positions],
  );

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = new Map<Group, LiveMember[]>();
    for (const m of live?.members ?? []) {
      if (q && !name(m).toLowerCase().includes(q)) continue;
      const g = groupOf(m);
      if (g) out.set(g, [...(out.get(g) ?? []), m]);
    }
    return out;
  }, [live?.members, query, groupOf]);

  // Harita katmanları: yüzlerce işaretçi için DOM yerine tek GeoJSON kaynağı.
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady || !live) return;
    const features = Object.values(live.positions).flatMap((p) => {
      const mem = members.get(p.u);
      if (!mem || (mem.role !== "pilot" && mem.role !== "retriever")) return [];
      const f = freshness(age(p));
      const color = sosBy.has(p.u) ? "#ff4d3d" : mem.role === "retriever" ? RETRIEVER_COLOR : STATE_COLOR[mem.pilot_state ?? "preparing"];
      return [{
        type: "Feature" as const, id: p.u,
        geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
        properties: { id: p.u, color, role: mem.role, opacity: f === "live" ? 1 : f === "stale" ? 0.6 : 0.3,
          label: mem.bib ? `#${mem.bib}` : mem.first_name, selected: p.u === selected ? 1 : 0, sos: sosBy.has(p.u) ? 1 : 0 },
      }];
    });
    const requests = (live.retrieves ?? []).map((r) => ({
      type: "Feature" as const, id: r.id, geometry: { type: "Point" as const, coordinates: [r.lon, r.lat] },
      properties: { id: r.pilot_id, open: r.status === "open" ? 1 : 0 },
    }));
    (m.getSource("people") as GeoJSONSource).setData({ type: "FeatureCollection", features });
    (m.getSource("requests") as GeoJSONSource).setData({ type: "FeatureCollection", features: requests });
  }, [live, members, sosBy, selected, mapReady, age]);

  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;
    (m.getSource("track") as GeoJSONSource).setData({ type: "FeatureCollection",
      features: track ? [{ type: "Feature", geometry: { type: "LineString", coordinates: track }, properties: {} }] : [] });
  }, [track, mapReady]);

  const selPos = selected ? live?.positions[selected] : undefined;
  useEffect(() => {
    if (follow && selPos && map.current) map.current.easeTo({ center: [selPos.lon, selPos.lat], duration: 800, padding: PANEL_PADDING });
  }, [follow, selPos]);

  const onMapReady = useCallback((m: MlMap) => {
    map.current = m;
    m.addSource("track", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addLayer({ id: "track", type: "line", source: "track", paint: { "line-color": "#f3a712", "line-width": 3, "line-opacity": 0.85 } });
    m.addSource("requests", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addLayer({ id: "requests", type: "circle", source: "requests",
      paint: { "circle-radius": ["case", ["==", ["get", "open"], 1], 16, 13], "circle-color": "transparent",
        "circle-stroke-color": "#ff8a3d", "circle-stroke-width": 2.5, "circle-stroke-opacity": 0.9 } });
    m.addSource("people", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addLayer({ id: "people", type: "circle", source: "people",
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], 1], 10, ["==", ["get", "sos"], 1], 10, 7],
        "circle-color": ["get", "color"], "circle-opacity": ["get", "opacity"],
        "circle-stroke-color": ["case", ["==", ["get", "role"], "retriever"], "#f3a712", "#0a0b0d"],
        "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 4, ["==", ["get", "role"], "retriever"], 3, 1.5],
        "circle-stroke-opacity": ["get", "opacity"],
      } });
    m.addLayer({ id: "people-label", type: "symbol", source: "people",
      layout: { "text-field": ["get", "label"], "text-size": 11, "text-font": ["Noto Sans Regular"], "text-offset": [0, 1.4], "text-anchor": "top", "text-allow-overlap": false },
      paint: { "text-color": "#ffffff", "text-halo-color": "#0a0b0d", "text-halo-width": 1.6, "text-opacity": ["get", "opacity"] } });
    for (const layer of ["people", "requests"]) {
      m.on("click", layer, (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) setSelected(id);
        const c = (e.features?.[0]?.geometry as { coordinates?: [number, number] } | undefined)?.coordinates;
        if (c) m.easeTo({ center: c, padding: PANEL_PADDING });
      });
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
    }
    setMapReady(true);
  }, []);

  useEffect(() => {
    if (ev && map.current && mapReady) setEventFeatures(map.current, ev.points, ev.zones);
  }, [ev, mapReady]);

  useEffect(() => {
    setTrack(null);
    setFollow(false);
  }, [selected]);

  // İlk konumlar gelince bir kez herkesi kapsayacak şekilde yakınlaş.
  const fitted = useRef(false);
  useEffect(() => {
    const pts = Object.values(live?.positions ?? {});
    if (fitted.current || !mapReady || !map.current || pts.length === 0) return;
    fitted.current = true;
    const lons = pts.map((p) => p.lon), lats = pts.map((p) => p.lat);
    map.current.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: { top: 140, bottom: 100, left: 420, right: 400 }, maxZoom: 13, duration: 0 });
  }, [live?.positions, mapReady]);

  if (error) return <div className="p-8"><ErrorText>{error}</ErrorText></div>;
  if (!ev) return <div className="flex h-dvh items-center justify-center"><Spinner /></div>;

  const center: [number, number] = [ev.center_lon ?? ev.points[0]?.lon ?? 29.3, ev.center_lat ?? ev.points[0]?.lat ?? 37.1];
  const activeSos = (live?.sos ?? []).filter((s) => s.status !== "resolved");
  const sel = selected ? members.get(selected) : undefined;
  const count = (g: Group) => grouped.get(g)?.length ?? 0;
  const waiting = (live?.retrieves ?? []).filter((r) => r.status === "open");
  const lost = grouped.get("lost") ?? [];
  const fitAll = () => {
    const pts = Object.values(live?.positions ?? {});
    if (!map.current || pts.length === 0) return;
    const lons = pts.map((p) => p.lon), lats = pts.map((p) => p.lat);
    map.current.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: { top: 140, bottom: 100, left: 440, right: sel ? 440 : 400 }, maxZoom: 14, duration: 700 });
  };
  const focus = (id: string) => {
    setSelected(id);
    const p = live?.positions[id];
    if (p) map.current?.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.current.getZoom(), 12), padding: PANEL_PADDING });
  };

  return (
    <div className="relative h-dvh overflow-hidden bg-ink">
      <MapView center={center} zoom={ev.center_lat ? 11 : 8} onReady={onMapReady} controls={false} className="absolute inset-0" />

      {/* Sol sütun: gezinme, özet, liste */}
      <aside className="pointer-events-none absolute inset-y-4 left-4 z-10 flex w-[372px] flex-col gap-3 max-md:hidden">
        <nav className="glass pointer-events-auto flex items-center gap-1 rounded-full p-1.5">
          <Link href={`/events/${eventId}`} aria-label={t("common.back")} className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-ivory">
            <svg viewBox="0 0 1024 1024" className="h-5 w-5" aria-hidden><path fill="#F3A712" d="M512 164 790 850 512 704 234 850 512 164Zm0 176-125 310 125-66 125 66-125-310Z" /></svg>
          </Link>
          <span className="h-9 rounded-full bg-white/[0.12] px-4 text-[13px] leading-9">{t("live.title")}</span>
          <Link href={`/app/events/${eventId}/manage`} className="h-9 rounded-full px-4 text-[13px] leading-9 text-muted hover:text-ivory">{t("events.manage")}</Link>
          <Link href={`/events/${eventId}`} className="h-9 rounded-full px-4 text-[13px] leading-9 text-muted hover:text-ivory">{t("live.event")}</Link>
        </nav>

        <div className="pointer-events-auto grid grid-cols-2 gap-2">
          <Stat2 label={t("live.group.flying")} value={count("flying")} dot={STATE_COLOR.flying} />
          <Stat2 label={t("live.group.waiting")} value={count("waiting")} dot={STATE_COLOR.awaiting_retrieve} />
          <Stat2 label={t("live.group.picked_up")} value={count("picked_up") + count("assigned")} dot={STATE_COLOR.picked_up} />
          <Stat2 label={t("live.group.lost")} value={count("lost")} dot="#8b8d94" alert={count("lost") > 0} />
        </div>

        <section className="glass pointer-events-auto flex min-h-0 flex-1 flex-col rounded-[28px]">
          <div className="flex items-center gap-2 p-3 pb-2">
            <Pills value={tab} onChange={setTab} options={[{ value: "ops", label: t("live.all") }, { value: "log", label: t("live.timeline") }]} />
            <span className="ml-auto flex items-center gap-1.5 pr-1 text-xs text-muted">
              <span className={cx("h-1.5 w-1.5 rounded-full", status === "live" ? "bg-ok" : status === "offline" ? "bg-danger" : "animate-pulse bg-amber")} />
              {t(`live.connection.${status}`)}
            </span>
          </div>
          {tab === "ops" ? (
            <>
              <div className="px-3 pb-2">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("live.search")}
                  className="h-10 w-full rounded-full border border-white/[0.06] bg-white/[0.04] px-4 text-sm placeholder:text-muted/60 focus:border-amber/50 focus:outline-none" />
              </div>
              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {!live && <div className="flex justify-center py-8"><Spinner /></div>}
                {GROUPS.map((g) => {
                  const list = grouped.get(g);
                  if (!list?.length) return null;
                  return (
                    <section key={g} className="mt-1">
                      <p className={cx("kicker px-2 pb-1 pt-3", g === "sos" && "text-danger")}>{t(`live.group.${g}` as MessageKey)} · {list.length}</p>
                      <div className="space-y-1">
                        {list.map((m) => (
                          <MemberRow key={m.user_id} m={m} pos={live?.positions[m.user_id]} ageMs={age(live?.positions[m.user_id])}
                            stops={stopsByRetriever.get(m.user_id)?.length ?? 0} selected={selected === m.user_id} onClick={() => focus(m.user_id)} />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
          ) : (
            <Timeline eventId={eventId} members={members} lastSeq={live?.last_seq ?? 0} />
          )}
        </section>
      </aside>

      {/* Başlık */}
      <div className="pointer-events-none absolute left-[408px] top-6 z-10 max-xl:hidden">
        <h1 className="text-[34px] font-light leading-tight tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">{ev.name}</h1>
        <div className="mt-2 flex gap-2">
          <Badge tone={ev.status === "active" ? "amber" : "default"}>{t(`status.${ev.status}`)}</Badge>
          <Badge>{t("events.members", { n: live?.members.length ?? ev.member_count })}</Badge>
        </div>
      </div>

      {/* Sağ sütun: uyarılar + seçili kişi */}
      <aside className="pointer-events-none absolute inset-y-4 right-4 z-10 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-3">
        {(activeSos.length > 0 || (!sel && (waiting.length > 0 || lost.length > 0))) && (
          <section className="glass pointer-events-auto max-h-[50%] overflow-y-auto rounded-[28px] p-3 scroll-thin">
            {!sel && <p className="kicker px-2 pb-2">{t("live.alerts")}</p>}
            <div className="space-y-2">
              {activeSos.map((s) => {
                const m = members.get(s.user_id);
                return (
                  <button key={s.id} onClick={() => focus(s.user_id)}
                    className={cx("w-full rounded-[20px] border border-danger/30 bg-danger/15 p-3 text-left", s.status === "active" && "sos-pulse")}>
                    <span className="flex items-center gap-2 text-sm font-medium text-white">
                      <span className="rounded-full bg-danger px-2 py-0.5 text-[11px] font-bold">SOS</span>
                      {m ? name(m) : "?"}
                    </span>
                    <span className="num mt-1 block text-xs text-white/70">
                      {formatDate(locale, s.created_at, { hour: "2-digit", minute: "2-digit" })}{s.status === "acknowledged" ? ` · ${t("live.sos_ack")}` : ""}{s.message ? ` · ${s.message}` : ""}
                    </span>
                  </button>
                );
              })}
              {!sel && waiting.map((r) => {
                const m = members.get(r.pilot_id);
                return (
                  <button key={r.id} onClick={() => focus(r.pilot_id)} className="tile w-full rounded-[20px] p-3 text-left hover:bg-white/[0.07]">
                    <span className="flex items-center gap-2 text-sm">
                      <span className="h-2 w-2 rounded-full" style={{ background: STATE_COLOR.awaiting_retrieve }} />
                      {m ? name(m) : "?"}
                      <span className="num ml-auto text-xs text-muted">{shortAge(locale, now - Date.parse(r.requested_at))}</span>
                    </span>
                    <span className="mt-1 block text-xs text-muted">{t("pilot.awaiting_retrieve")}{r.note ? ` · “${r.note}”` : ""}</span>
                  </button>
                );
              })}
              {!sel && lost.map((m) => (
                <button key={m.user_id} onClick={() => focus(m.user_id)} className="tile w-full rounded-[20px] p-3 text-left hover:bg-white/[0.07]">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="h-2 w-2 rounded-full bg-muted" />{name(m)}
                    <span className="num ml-auto text-xs text-muted">{shortAge(locale, age(live?.positions[m.user_id]))}</span>
                  </span>
                  <span className="mt-1 block text-xs text-muted">{t("live.group.lost")}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {sel && live && (
          <DetailPanel
            key={sel.user_id}
            eventId={eventId}
            m={sel}
            pos={live.positions[sel.user_id]}
            ageMs={age(live.positions[sel.user_id])}
            retrieve={retrieveByPilot.get(sel.user_id)}
            stops={stopsByRetriever.get(sel.user_id) ?? []}
            sos={sosBy.get(sel.user_id)}
            members={members}
            vehicles={ev.vehicles}
            follow={follow}
            onFollow={() => setFollow((f) => !f)}
            trackShown={!!track}
            onTrack={async () => {
              if (track) return setTrack(null);
              const since = new Date(Date.now() - 12 * 3600_000).toISOString();
              const r = await api.events.track(eventId, sel.user_id, { from: since });
              setTrack(r.points.map((p) => [p[2], p[1]]));
            }}
            onClose={() => setSelected(null)}
          />
        )}
      </aside>

      {/* Harita kontrolleri */}
      <div className="absolute bottom-5 left-[408px] z-10 flex gap-2 max-md:left-4">
        <RoundButton label="+" onClick={() => map.current?.zoomIn()} />
        <RoundButton label="◎" title={t("live.fit_all")} onClick={fitAll} />
        <RoundButton label="−" onClick={() => map.current?.zoomOut()} />
      </div>
    </div>
  );
}

function RoundButton({ label, title, onClick }: { label: string; title?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title} aria-label={title ?? label}
      className="glass flex h-11 w-11 items-center justify-center rounded-full text-lg text-ivory hover:bg-white/10">{label}</button>
  );
}

function Stat2({ label, value, dot, alert }: { label: string; value: number; dot: string; alert?: boolean }) {
  return (
    <div className={cx("glass rounded-[22px] px-4 py-3", alert && "border-danger/30")}>
      <p className="flex items-center gap-2 text-[12px] text-muted"><span className="h-2 w-2 rounded-full" style={{ background: dot }} />{label}</p>
      <p className="num mt-1 text-[32px] font-light leading-none tracking-tight">{value}</p>
    </div>
  );
}

function MemberRow({ m, pos, ageMs, stops, selected, onClick }: {
  m: LiveMember; pos?: Position; ageMs: number; stops: number; selected: boolean; onClick: () => void;
}) {
  const { t, locale } = useI18n();
  const f = pos ? freshness(ageMs) : null;
  const color = m.role === "retriever" ? RETRIEVER_COLOR : STATE_COLOR[m.pilot_state ?? "preparing"];
  return (
    <button onClick={onClick} className={cx("flex w-full items-center gap-3 rounded-[18px] px-3 py-2.5 text-left transition hover:bg-white/[0.06]", selected && "bg-white/[0.09]")}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, opacity: f === "lost" ? 0.35 : 1, boxShadow: `0 0 0 3px ${color}22` }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{name(m)}</span>
        <span className="block truncate text-xs text-muted">
          {m.role === "retriever"
            ? stops ? `${t("live.on_duty")} · ${t("live.stops", { n: stops })}` : m.is_available ? t("live.available") : t("live.busy")
            : t(`pilot.${m.pilot_state ?? "preparing"}`)}
        </span>
      </span>
      <span className={cx("num shrink-0 text-right text-xs", f === "live" ? "text-ok" : f === "stale" ? "text-amber" : "text-muted")}>
        {pos ? shortAge(locale, ageMs) : m.tracking ? "…" : "—"}
        {pos?.bat != null && <span className="block text-muted">{pos.bat}%</span>}
      </span>
    </button>
  );
}

function DetailPanel(props: {
  eventId: string; m: LiveMember; pos?: Position; ageMs: number; retrieve?: Retrieve; stops: Retrieve[]; sos?: SosAlert;
  members: Map<string, LiveMember>; vehicles: EventDetail["vehicles"]; follow: boolean; onFollow: () => void;
  trackShown: boolean; onTrack: () => void; onClose: () => void;
}) {
  const { eventId, m, pos, ageMs, retrieve, stops, sos, members } = props;
  const { t, err, locale } = useI18n();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (x) {
      setError(err(errorCode(x)));
    } finally {
      setBusy(false);
    }
  }

  const retrievers = [...members.values()].filter((x) => x.role === "retriever");
  const state = m.pilot_state;
  const f = pos ? freshness(ageMs) : null;
  const vehicle = props.vehicles.find((v) => v.id === m.vehicle_id);

  return (
    <div className="glass pointer-events-auto flex min-h-0 flex-1 flex-col rounded-[28px]">
      <div className="flex items-start gap-3 p-5 pb-3">
        <div className="min-w-0 flex-1">
          <p className="kicker">{t(`role.${m.role}`)}</p>
          <h2 className="truncate text-2xl font-light tracking-tight">{name(m)}</h2>
          {m.role === "pilot" && <Badge tone="amber">{t(`pilot.${state ?? "preparing"}`)}</Badge>}
          {m.role === "retriever" && <Badge tone={m.is_available ? "ok" : "default"}>{m.is_available ? t("live.available") : t("live.busy")}</Badge>}
        </div>
        <button onClick={props.onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-lg text-muted hover:text-ivory" aria-label={t("common.close")}>×</button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5">
        {sos && (
          <div className="rounded-[20px] border border-danger/40 bg-danger/15 p-4">
            <p className="font-bold text-danger">SOS · {formatDate(locale, sos.created_at, { hour: "2-digit", minute: "2-digit" })}</p>
            {sos.message && <p className="mt-1 text-sm">{sos.message}</p>}
            <p className="mt-2 text-xs text-muted">{t("live.sos_disclaimer")}</p>
            <div className="mt-3 flex gap-2">
              {sos.status === "active" && <Button size="sm" variant="danger" disabled={busy} onClick={() => run(() => api.ops.sosAction(sos.id, "ack"))}>{t("live.sos_ack")}</Button>}
              <Button size="sm" disabled={busy} onClick={() => run(() => api.ops.sosAction(sos.id, "resolve"))}>{t("live.sos_resolve")}</Button>
            </div>
          </div>
        )}

        <div>
          <p className="kicker">{t("live.last_fix")}</p>
          {pos ? (
            <>
              <p className={cx("num mt-1 text-sm", f === "live" ? "text-ok" : f === "stale" ? "text-amber" : "text-danger")}>
                {t("live.age", { age: shortAge(locale, ageMs) })}{pos.acc != null && ` · ${t("live.accuracy", { m: Math.round(pos.acc) })}`}
              </p>
              <div className="num mt-3 grid grid-cols-2 gap-2">
                <Stat label={t("live.altitude")} value={pos.alt != null ? `${Math.round(pos.alt)} m` : "—"} />
                <Stat label={t("live.speed")} value={pos.spd != null ? `${Math.round(pos.spd * 3.6)} km/h` : "—"} />
                <Stat label={t("live.battery")} value={pos.bat != null ? `${pos.bat}%` : "—"} />
                <Stat label={t("live.heading")} value={pos.hdg != null ? `${Math.round(pos.hdg)}°` : "—"} />
              </div>
              <p className="num mt-2 text-xs text-muted">{pos.lat.toFixed(5)}, {pos.lon.toFixed(5)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={props.onFollow}>{props.follow ? t("live.unfollow") : t("live.follow")}</Button>
                <Button size="sm" onClick={props.onTrack}>{props.trackShown ? t("live.hide_track") : t("live.track")}</Button>
                <Button size="sm" onClick={() => {
                  void navigator.clipboard.writeText(`${m.first_name} ${m.last_name}: https://maps.google.com/?q=${pos.lat.toFixed(6)},${pos.lon.toFixed(6)}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}>{copied ? t("live.copied") : t("live.copy_position")}</Button>
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">{m.tracking ? t("live.no_position") : t("live.not_tracking")}</p>
          )}
        </div>

        {m.phone && (
          <div>
            <p className="kicker">{t("live.phone")}</p>
            <a href={`tel:${m.phone}`} className="mt-1 block text-amber">{m.phone}</a>
          </div>
        )}

        {m.role === "pilot" && (
          <div className="space-y-3">
            {retrieve && (
              <div className="tile rounded-[20px] p-4">
                <p className="kicker">{t(`retrieve.${retrieve.status}`)}</p>
                <p className="num mt-1 text-sm text-muted">{t("live.since", { time: formatDate(locale, retrieve.requested_at, { hour: "2-digit", minute: "2-digit" }) })}</p>
                {retrieve.note && <p className="mt-1 text-sm">“{retrieve.note}”</p>}
                {retrieve.retriever_id && <p className="mt-2 text-sm">→ {members.get(retrieve.retriever_id) ? name(members.get(retrieve.retriever_id)!) : "?"}</p>}
                {retrieve.status !== "picked_up" && (
                  <Select className="mt-3" value="" disabled={busy}
                    onChange={(e) => e.target.value && run(() => api.ops.retrieve(retrieve.id, "assign", { retriever_id: e.target.value }))}>
                    <option value="">{t("live.choose_retriever")}</option>
                    {retrievers.map((r) => (
                      <option key={r.user_id} value={r.user_id}>
                        {name(r)} · {r.is_available ? t("live.available") : t("live.busy")}
                      </option>
                    ))}
                  </Select>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {(retrieve.status === "assigned" || retrieve.status === "arrived") && (
                    <Button size="sm" disabled={busy} onClick={() => run(() => api.ops.retrieve(retrieve.id, "release"))}>{t("live.release")}</Button>
                  )}
                  {retrieve.status !== "picked_up" && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => confirm(t("common.confirm")) && run(() => api.ops.retrieve(retrieve.id, "cancel", { reason: "observer" }))}>{t("live.cancel_request")}</Button>
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {(!state || state === "preparing" || state === "completed") && (
                <Button size="sm" disabled={busy} onClick={() => run(() => api.ops.takeoff(eventId, m.user_id))}>{t("live.mark_takeoff")}</Button>
              )}
              {state === "flying" && (
                <Button size="sm" disabled={busy} onClick={() => run(() => api.ops.land(eventId, { pilot_id: m.user_id, lat: pos?.lat, lon: pos?.lon }))}>{t("live.mark_landed")}</Button>
              )}
              {!retrieve && pos && (state === "flying" || state === "landed") && (
                <Button size="sm" variant="primary" disabled={busy} onClick={() => run(() => api.ops.requestRetrieve(eventId, { pilot_id: m.user_id, lat: pos.lat, lon: pos.lon }))}>{t("live.request_for")}</Button>
              )}
              {(state === "landed" || state === "awaiting_retrieve" || state === "flying") && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api.ops.completeFlight(eventId, m.user_id))}>{t("live.complete_flight")}</Button>
              )}
            </div>
            <p className="text-xs text-muted">{t("live.manual_note")}</p>
          </div>
        )}

        {m.role === "retriever" && (
          <div className="space-y-2">
            {vehicle && <p className="text-sm text-muted">{vehicle.name}{vehicle.plate ? ` · ${vehicle.plate}` : ""} · {t("live.capacity", { used: stops.length, cap: vehicle.capacity })}</p>}
            {stops.map((r) => {
              const p = members.get(r.pilot_id);
              return (
                <div key={r.id} className="tile flex items-center justify-between rounded-[18px] px-4 py-2.5 text-sm">
                  <span>{p ? name(p) : "?"}</span>
                  <Badge>{t(`retrieve.${r.status}`)}</Badge>
                </div>
              );
            })}
          </div>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile rounded-[18px] px-4 py-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 text-2xl font-light tracking-tight">{value}</p>
    </div>
  );
}

const LOG_KEYS: Record<string, MessageKey> = {
  "flight.takeoff": "pilot.flying",
  "flight.landed": "pilot.landed",
  "flight.completed": "pilot.completed",
  "retrieve.requested": "pilot.awaiting_retrieve",
  "retrieve.assigned": "retrieve.assigned",
  "retrieve.released": "live.release",
  "retrieve.arrived": "retrieve.arrived",
  "retrieve.picked_up": "retrieve.picked_up",
  "retrieve.completed": "retrieve.completed",
  "retrieve.cancelled": "retrieve.cancelled",
  "sos.raised": "live.sos",
  "sos.acknowledged": "live.sos_ack",
  "sos.resolved": "live.sos_resolve",
};

function Timeline({ eventId, members, lastSeq }: { eventId: string; members: Map<string, LiveMember>; lastSeq: number }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<OpEvent[]>([]);
  useEffect(() => {
    void (async () => {
      // Son ~500 olay; sayfalama Faz 4.
      const r = await api.events.log(eventId, Math.max(0, lastSeq - 500));
      setItems(r.data.reverse());
    })();
  }, [eventId, lastSeq]);
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-3">
      {items.filter((e) => LOG_KEYS[e.t]).map((e) => {
        const s = e.subject ? members.get(e.subject) : undefined;
        return (
          <div key={e.seq} className="mx-2 flex gap-3 rounded-[16px] px-3 py-2 text-sm hover:bg-white/[0.04]">
            <span className="num w-12 shrink-0 text-xs text-muted">{formatDate(locale, new Date(e.at).toISOString(), { hour: "2-digit", minute: "2-digit" })}</span>
            <span className="min-w-0">
              <span className="block truncate">{s ? name(s) : ""}</span>
              <span className={cx("text-xs", e.t.startsWith("sos") ? "text-danger" : "text-muted")}>{t(LOG_KEYS[e.t]!)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
