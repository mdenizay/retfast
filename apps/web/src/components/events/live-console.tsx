"use client";
import {
  ArrowLeft, Check, CircleCheck, Clock, Copy, Download, LifeBuoy, ListFilter, LocateFixed, Minus, Navigation, Pause, PlaneLanding, Play, Plus, Phone, Route,
  Scan, Search, Settings2, Siren, Spline, WifiOff, X, Car, CarFront,
} from "lucide-react";
import Link from "next/link";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  connectLive, freshness, positionAge, shortAge, type ConnectionStatus, type EventDetail, type LiveMember, type LiveState,
  type MessageKey, type OpEvent, type PilotState, type Position, type Retrieve, type SosAlert,
} from "@retfast/core";
import { MapView, THREE_D, setEventFeatures } from "@/components/map";
import { MapLayerControl } from "@/components/map-controls";
import {
  Badge, Button, ConfirmDialog, ErrorText, IconButton, Pills, Select, Sheet, SheetContent, SheetHeader, SheetTitle, Spinner, cx,
} from "@/components/ui";
import { api, errorCode, wsBase } from "@/lib/api";
import { isDarkBase, type BasemapId } from "@/lib/basemaps";
import { useMapPrefs } from "@/lib/map-prefs";
import { formatDate, useI18n } from "@/lib/i18n";
import { STATE_COLOR, addMarkerImages } from "@/lib/marker-icons";

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

const STATE_ICON: Record<PilotState, Icon> = {
  preparing: Clock,
  flying: Navigation,
  landed: PlaneLanding,
  awaiting_retrieve: LifeBuoy,
  retriever_assigned: Route,
  picked_up: CarFront,
  completed: CircleCheck,
};
const RETRIEVER_COLOR = "#e5e5ea";
// Yüzen paneller haritanın iki yanını kapatır; odaklanan nokta görünür alanın ortasına gelsin.
const PANEL_PADDING = { top: 100, bottom: 100, left: 430, right: 400 };

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

const boundMaps = new WeakSet<MlMap>();

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
  const [drawer, setDrawer] = useState(false);
  const [replayFor, setReplayFor] = useState<string | null>(null);
  const map = useRef<MlMap | null>(null);
  // Her stil yüklemesinde artar; harita verisini yeniden yazma tetikleyicisi.
  const [styleRev, setStyleRev] = useState(0);
  const [base, setBase] = useState<BasemapId>("dark");
  const onDark = isDarkBase(base);
  const { threeD } = useMapPrefs();

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

  // Harita verisi: yüzlerce işaretçi için DOM yerine tek GeoJSON kaynağı.
  useEffect(() => {
    const m = map.current;
    if (!m || styleRev === 0 || !live) return;
    try {
      const features = Object.values(live.positions).flatMap((p) => {
        const mem = members.get(p.u);
        if (!mem || (mem.role !== "pilot" && mem.role !== "retriever")) return [];
        const f = freshness(age(p));
        const sos = sosBy.has(p.u);
        const stateKey = sos ? "sos" : (mem.pilot_state ?? "preparing");
        const moving = mem.role === "pilot" && (p.spd ?? 0) > 1.5 && p.hdg != null;
        return [{
          type: "Feature" as const, id: p.u,
          geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
          properties: {
            id: p.u, role: mem.role, sos: sos ? 1 : 0, selected: p.u === selected ? 1 : 0,
            icon: mem.role === "retriever" ? "car" : `${moving ? "arrow" : "dot"}-${stateKey}`,
            hdg: moving ? p.hdg : 0,
            opacity: f === "live" ? 1 : f === "stale" ? 0.62 : 0.34,
            label: mem.bib ? `#${mem.bib}` : mem.first_name,
          },
        }];
      });
      const requests = (live.retrieves ?? []).map((r) => ({
        type: "Feature" as const, id: r.id, geometry: { type: "Point" as const, coordinates: [r.lon, r.lat] },
        properties: { id: r.pilot_id, open: r.status === "open" ? 1 : 0 },
      }));
      (m.getSource("people") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
      (m.getSource("requests") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: requests });
    } catch {
      /* stil değişiyor; sonraki stil yüklemesi veriyi yeniden yazar */
    }
  }, [live, members, sosBy, selected, styleRev, age]);

  // Etiket renkleri zemine göre.
  useEffect(() => {
    const m = map.current;
    if (!m || styleRev === 0 || !m.getLayer("people")) return;
    m.setPaintProperty("people", "text-color", onDark ? "#ffffff" : "#1c1c1e");
    m.setPaintProperty("people", "text-halo-color", onDark ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.92)");
  }, [onDark, styleRev]);

  useEffect(() => {
    const m = map.current;
    if (!m || styleRev === 0) return;
    (m.getSource("track") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection",
      features: track ? [{ type: "Feature", geometry: { type: "LineString", coordinates: track }, properties: {} }] : [] });
  }, [track, styleRev]);

  const selPos = selected ? live?.positions[selected] : undefined;
  useEffect(() => {
    if (follow && selPos && map.current) map.current.easeTo({ center: [selPos.lon, selPos.lat], duration: 800, padding: PANEL_PADDING });
  }, [follow, selPos]);

  const onMapReady = useCallback(async (m: MlMap, b: BasemapId) => {
    map.current = m;
    setBase(b);
    try {
      await addMarkerImages(m);
      const empty = { type: "FeatureCollection" as const, features: [] };
      if (!m.getSource("track")) {
        m.addSource("track", { type: "geojson", data: empty });
        m.addLayer({ id: "track-casing", type: "line", source: "track", layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#000000", "line-opacity": 0.35, "line-width": 6.5 } });
        m.addLayer({ id: "track", type: "line", source: "track", layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffb020", "line-width": 3.5 } });
      }
      if (!m.getSource("replay")) {
        m.addSource("replay", { type: "geojson", data: empty });
        m.addLayer({ id: "replay-line", type: "line", source: "replay", filter: ["==", ["geometry-type"], "LineString"],
          layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffb020", "line-width": 4 } });
        m.addLayer({ id: "replay-dot", type: "circle", source: "replay", filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-radius": 9, "circle-color": "#ffb020", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
      }
      if (!m.getSource("requests")) {
        m.addSource("requests", { type: "geojson", data: empty });
        m.addLayer({ id: "requests", type: "circle", source: "requests",
          paint: { "circle-radius": ["case", ["==", ["get", "open"], 1], 20, 16], "circle-color": "rgba(255,159,10,0.16)",
            "circle-stroke-color": "#ff9f0a", "circle-stroke-width": 2.5 } });
      }
      if (!m.getSource("people")) {
        m.addSource("people", { type: "geojson", data: empty });
        m.addLayer({ id: "people-halo", type: "circle", source: "people",
          filter: ["any", ["==", ["get", "sos"], 1], ["==", ["get", "selected"], 1]],
          paint: { "circle-radius": 24, "circle-color": ["case", ["==", ["get", "sos"], 1], "rgba(255,69,58,0.3)", "rgba(255,176,32,0.3)"],
            "circle-stroke-width": 1.5, "circle-stroke-color": ["case", ["==", ["get", "sos"], 1], "#ff453a", "#ffb020"] } });
        m.addLayer({ id: "people", type: "symbol", source: "people",
          layout: {
            "icon-image": ["get", "icon"], "icon-rotate": ["get", "hdg"], "icon-rotation-alignment": "map",
            "icon-allow-overlap": true, "icon-ignore-placement": true,
            "icon-size": ["case", ["==", ["get", "selected"], 1], 1.18, 1],
            "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11.5,
            "text-offset": [0, 1.55], "text-anchor": "top", "text-optional": true,
          },
          paint: { "icon-opacity": ["get", "opacity"], "text-opacity": ["get", "opacity"], "text-halo-width": 1.5 } });
      }
      if (!boundMaps.has(m)) {
        boundMaps.add(m);
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
      }
      setStyleRev((r) => r + 1);
    } catch {
      /* stil yükleme sırasında değişti; yeni style.load yeniden çağırır */
    }
  }, []);

  useEffect(() => {
    const m = map.current;
    if (ev && m && styleRev > 0) {
      try {
        setEventFeatures(m, ev.points, ev.zones, onDark);
      } catch {
        /* stil değişiyor */
      }
    }
  }, [ev, styleRev, onDark]);

  useEffect(() => {
    setTrack(null);
    setFollow(false);
  }, [selected]);

  // İlk konumlar gelince bir kez herkesi kapsayacak şekilde yakınlaş.
  const fitted = useRef(false);
  useEffect(() => {
    const pts = Object.values(live?.positions ?? {});
    if (fitted.current || styleRev === 0 || !map.current || pts.length === 0) return;
    fitted.current = true;
    const lons = pts.map((p) => p.lon), lats = pts.map((p) => p.lat);
    // Eğik kamerada sınır hesabı çok uzaktan başlar: önce düz bak, sonra 3B'ye yumuşakça geç.
    map.current.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: PANEL_PADDING, maxZoom: 13, duration: 0, pitch: 0, bearing: 0 });
    if (threeD) map.current.easeTo({ pitch: THREE_D.pitch, bearing: THREE_D.bearing, duration: 1200 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.positions, styleRev]);

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
    const bounds: [[number, number], [number, number]] = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
    map.current.fitBounds(bounds, { padding: PANEL_PADDING, maxZoom: 14, duration: 700, ...(threeD ? {} : { pitch: 0, bearing: 0 }) });
  };
  const focus = (id: string) => {
    setSelected(id);
    setDrawer(false);
    const p = live?.positions[id];
    if (p) map.current?.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.current.getZoom(), 12), padding: PANEL_PADDING });
  };

  const listPanel = (
    <>
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <Pills value={tab} onChange={setTab} className="min-w-0 flex-1 [&>div]:w-full"
          options={[{ value: "ops", label: t("live.all") }, { value: "log", label: t("live.timeline") }]} />
      </div>
      {tab === "ops" ? (
        <>
          <div className="px-3 pb-2">
            <div className="relative">
              <Search size={16} strokeWidth={2} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-label-2" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("live.search")}
                className="h-10 w-full rounded-full bg-fill pl-10 pr-4 text-[15px] outline-none transition placeholder:text-label-3 focus:bg-fill-2 focus:ring-2 focus:ring-tint/45" />
            </div>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {!live && <div className="flex justify-center py-8"><Spinner /></div>}
            {GROUPS.map((g) => {
              const list = grouped.get(g);
              if (!list?.length) return null;
              return (
                <section key={g} className="mt-3 first:mt-1">
                  <p className={cx("t-section px-2 pb-1.5", g === "sos" && "text-danger")}>{t(`live.group.${g}` as MessageKey)} · {list.length}</p>
                  <div className="group">
                    {list.map((m) => (
                      <MemberRow key={m.user_id} m={m} pos={live?.positions[m.user_id]} ageMs={age(live?.positions[m.user_id])}
                        stops={stopsByRetriever.get(m.user_id)?.length ?? 0} selected={selected === m.user_id} sos={sosBy.has(m.user_id)} onClick={() => focus(m.user_id)} />
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
    </>
  );

  return (
    <div className="relative h-dvh overflow-hidden bg-ink">
      <MapView center={center} zoom={ev.center_lat ? 11 : 8} onReady={onMapReady} chrome={false} className="absolute inset-0" />

      {/* Sol sütun: başlık çubuğu, özet, liste (md+) */}
      <aside className="pointer-events-none absolute left-4 top-4 z-10 flex w-[388px] flex-col gap-3 max-md:right-4 max-md:w-auto md:bottom-4">
        <header className="glass pointer-events-auto flex items-center gap-1.5 rounded-full p-1.5 pr-3">
          <Link href={`/events/${eventId}`} aria-label={t("common.back")} className="press flex size-10 items-center justify-center rounded-full bg-fill hover:bg-fill-2"><ArrowLeft size={19} /></Link>
          <div className="min-w-0 flex-1 px-1.5">
            <h1 className="truncate text-[16px] font-semibold leading-tight tracking-[-0.02em]">{ev.name}</h1>
            <p className="t-foot flex items-center gap-1.5">
              <span className={cx("h-1.5 w-1.5 rounded-full", status === "live" ? "bg-ok" : status === "offline" ? "bg-danger" : "animate-pulse bg-tint")} />
              {t(`live.connection.${status}`)} · {t("events.members", { n: live?.members.length ?? ev.member_count })}
            </p>
          </div>
          <Link href={`/app/events/${eventId}/manage`} aria-label={t("events.manage")} className="press flex size-10 items-center justify-center rounded-full hover:bg-fill-2"><Settings2 size={19} /></Link>
        </header>

        <div className="pointer-events-auto grid grid-cols-2 gap-2.5 max-md:hidden">
          <Metric icon={Navigation} color={STATE_COLOR.flying!} label={t("live.group.flying")} value={count("flying")} />
          <Metric icon={LifeBuoy} color={STATE_COLOR.awaiting_retrieve!} label={t("live.group.waiting")} value={count("waiting")} />
          <Metric icon={CarFront} color={STATE_COLOR.picked_up!} label={t("live.group.picked_up")} value={count("picked_up") + count("assigned")} />
          <Metric icon={WifiOff} color="#8e8e93" label={t("live.group.lost")} value={count("lost")} alert={count("lost") > 0} />
        </div>

        <section className="glass pointer-events-auto flex min-h-0 flex-1 flex-col rounded-[28px] max-md:hidden">{listPanel}</section>
      </aside>

      {/* Sağ sütun: uyarılar + seçili kişi */}
      <aside className="pointer-events-none absolute right-4 top-4 z-10 flex w-[372px] max-w-[calc(100vw-2rem)] flex-col gap-3 bottom-[88px] max-md:top-[84px]">
        {(activeSos.length > 0 || (!sel && (waiting.length > 0 || lost.length > 0))) && (
          <section className="glass pointer-events-auto scroll-thin max-h-[50%] shrink-0 overflow-y-auto rounded-[28px] p-3">
            {!sel && <p className="t-section px-2 pb-2">{t("live.alerts")}</p>}
            <div className="space-y-2">
              {activeSos.map((s) => {
                const m = members.get(s.user_id);
                return (
                  <button key={s.id} onClick={() => focus(s.user_id)}
                    className={cx("press w-full rounded-[20px] bg-danger/15 p-3.5 text-left ring-1 ring-inset ring-danger/30", s.status === "active" && "sos-pulse")}>
                    <span className="flex items-center gap-2 text-[14px] font-semibold">
                      <Siren size={17} className="text-danger" />
                      <span className="rounded-full bg-danger px-2 py-0.5 text-[11px] font-bold text-white">SOS</span>
                      <span className="truncate">{m ? name(m) : "?"}</span>
                    </span>
                    <span className="num t-foot mt-1 block">
                      {formatDate(locale, s.created_at, { hour: "2-digit", minute: "2-digit" })}{s.status === "acknowledged" ? ` · ${t("live.sos_ack")}` : ""}{s.message ? ` · ${s.message}` : ""}
                    </span>
                  </button>
                );
              })}
              {!sel && waiting.map((r) => {
                const m = members.get(r.pilot_id);
                return (
                  <button key={r.id} onClick={() => focus(r.pilot_id)} className="press tile w-full rounded-[20px] p-3.5 text-left hover:bg-fill-2">
                    <span className="flex items-center gap-2.5 text-[14px] font-medium">
                      <span className="flex size-7 items-center justify-center rounded-full" style={{ background: `${STATE_COLOR.awaiting_retrieve}2e`, color: STATE_COLOR.awaiting_retrieve }}><LifeBuoy size={15} /></span>
                      <span className="truncate">{m ? name(m) : "?"}</span>
                      <span className="num t-foot ml-auto">{shortAge(locale, now - Date.parse(r.requested_at))}</span>
                    </span>
                    <span className="t-foot mt-1 block">{t("pilot.awaiting_retrieve")}{r.note ? ` · “${r.note}”` : ""}</span>
                  </button>
                );
              })}
              {!sel && lost.map((m) => (
                <button key={m.user_id} onClick={() => focus(m.user_id)} className="press tile w-full rounded-[20px] p-3.5 text-left hover:bg-fill-2">
                  <span className="flex items-center gap-2.5 text-[14px] font-medium">
                    <span className="flex size-7 items-center justify-center rounded-full bg-fill-2 text-label-2"><WifiOff size={15} /></span>
                    <span className="truncate">{name(m)}</span>
                    <span className="num t-foot ml-auto">{shortAge(locale, age(live?.positions[m.user_id]))}</span>
                  </span>
                  <span className="t-foot mt-1 block">{t("live.group.lost")}</span>
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
            onReplay={() => setReplayFor(sel.user_id)}
            onClose={() => setSelected(null)}
          />
        )}
      </aside>

      {replayFor && live && (
        <ReplayBar key={replayFor} eventId={eventId} userId={replayFor} name={members.get(replayFor) ? name(members.get(replayFor)!) : ""} map={map} onClose={() => setReplayFor(null)} />
      )}

      {/* Harita kontrolleri */}
      <div className="absolute bottom-9 left-[420px] z-10 flex items-center gap-2.5 max-md:bottom-4 max-md:left-4">
        <div className="glass pointer-events-auto flex items-center gap-0.5 rounded-full p-1">
          <IconButton label={t("map.zoom_out")} onClick={() => map.current?.zoomOut()}><Minus /></IconButton>
          <IconButton label={t("map.zoom_in")} onClick={() => map.current?.zoomIn()}><Plus /></IconButton>
          <IconButton label={t("live.fit_all")} onClick={fitAll}><Scan /></IconButton>
        </div>
        <Button variant="secondary" size="md" className="glass md:hidden" onClick={() => setDrawer(true)}><ListFilter />{t("live.all")}</Button>
      </div>
      <div className="absolute bottom-9 right-4 z-10 max-md:bottom-4"><MapLayerControl placement="up" /></div>

      {/* Mobil: liste alt çekmecede */}
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="bottom" className="glass flex h-[78dvh] flex-col rounded-t-[28px] border-0 p-0">
          <SheetHeader className="sr-only"><SheetTitle>{t("live.all")}</SheetTitle></SheetHeader>
          {listPanel}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Metric({ icon: Icon, color, label, value, alert }: { icon: Icon; color: string; label: string; value: number; alert?: boolean }) {
  return (
    <div className={cx("glass rounded-[24px] p-4", alert && "ring-1 ring-danger/40")}>
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-full" style={{ background: `${color}2e`, color }}><Icon size={17} strokeWidth={2} /></span>
        <span className="t-foot leading-tight">{label}</span>
      </div>
      <p className="t-metric mt-3">{value}</p>
    </div>
  );
}

function MemberRow({ m, pos, ageMs, stops, selected, sos, onClick }: {
  m: LiveMember; pos?: Position; ageMs: number; stops: number; selected: boolean; sos: boolean; onClick: () => void;
}) {
  const { t, locale } = useI18n();
  const f = pos ? freshness(ageMs) : null;
  const key = m.pilot_state ?? "preparing";
  const color = sos ? STATE_COLOR.sos! : m.role === "retriever" ? "#ffb020" : STATE_COLOR[key]!;
  const Ico: Icon = sos ? Siren : m.role === "retriever" ? Car : STATE_ICON[key];
  return (
    <button onClick={onClick} className={cx("press flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-fill-2", selected && "bg-fill-2")}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full" style={{ background: `${color}2e`, color, opacity: f === "lost" ? 0.5 : 1 }}>
        <Ico size={18} strokeWidth={2} className={cx(key === "flying" && !sos && m.role === "pilot" && "-rotate-[20deg]")} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-tight">{name(m)}</span>
        <span className="t-foot block truncate">
          {m.role === "retriever"
            ? stops ? `${t("live.on_duty")} · ${t("live.stops", { n: stops })}` : m.is_available ? t("live.available") : t("live.busy")
            : t(`pilot.${key}`)}
        </span>
      </span>
      <span className={cx("num shrink-0 text-right text-[12.5px] font-medium", f === "live" ? "text-ok" : f === "stale" ? "text-tint" : "text-label-2")}>
        {pos ? shortAge(locale, ageMs) : m.tracking ? "…" : "—"}
        {pos?.bat != null && <span className="t-foot block font-normal">{pos.bat}%</span>}
      </span>
    </button>
  );
}

function DetailPanel(props: {
  eventId: string; m: LiveMember; pos?: Position; ageMs: number; retrieve?: Retrieve; stops: Retrieve[]; sos?: SosAlert;
  members: Map<string, LiveMember>; vehicles: EventDetail["vehicles"]; follow: boolean; onFollow: () => void;
  trackShown: boolean; onTrack: () => void; onReplay: () => void; onClose: () => void;
}) {
  const { eventId, m, pos, ageMs, retrieve, stops, sos, members } = props;
  const { t, err, locale } = useI18n();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

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
  const key = state ?? "preparing";
  const f = pos ? freshness(ageMs) : null;
  const vehicle = props.vehicles.find((v) => v.id === m.vehicle_id);
  const color = m.role === "retriever" ? "#ffb020" : STATE_COLOR[key]!;
  const Ico: Icon = m.role === "retriever" ? Car : STATE_ICON[key];

  return (
    <div className="glass pointer-events-auto flex min-h-0 flex-1 flex-col rounded-[28px]">
      <div className="flex items-start gap-3 p-5 pb-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full" style={{ background: `${color}2e`, color }}><Ico size={24} strokeWidth={1.9} /></span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="t-title truncate !text-[22px]">{name(m)}</h2>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="t-foot">{t(`role.${m.role}`)}</span>
            {m.role === "pilot" && <Badge tone="amber">{t(`pilot.${key}`)}</Badge>}
            {m.role === "retriever" && <Badge tone={m.is_available ? "ok" : "default"}>{m.is_available ? t("live.available") : t("live.busy")}</Badge>}
          </div>
        </div>
        <IconButton label={t("common.close")} className="size-9 bg-fill" onClick={props.onClose}><X /></IconButton>
      </div>

      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
        {sos && (
          <div className="rounded-[20px] bg-danger/15 p-4 ring-1 ring-inset ring-danger/30">
            <p className="flex items-center gap-2 font-semibold text-danger"><Siren size={17} />SOS · {formatDate(locale, sos.created_at, { hour: "2-digit", minute: "2-digit" })}</p>
            {sos.message && <p className="mt-1.5 text-[14px]">{sos.message}</p>}
            <p className="t-foot mt-2">{t("live.sos_disclaimer")}</p>
            <div className="mt-3 flex gap-2">
              {sos.status === "active" && <Button size="sm" variant="danger" disabled={busy} onClick={() => run(() => api.ops.sosAction(sos.id, "ack"))}>{t("live.sos_ack")}</Button>}
              <Button size="sm" disabled={busy} onClick={() => run(() => api.ops.sosAction(sos.id, "resolve"))}>{t("live.sos_resolve")}</Button>
            </div>
          </div>
        )}

        {pos ? (
          <>
            <p className={cx("num flex items-center gap-1.5 text-[13px] font-medium", f === "live" ? "text-ok" : f === "stale" ? "text-tint" : "text-danger")}>
              <span className="size-1.5 rounded-full bg-current" />
              {t("live.last_fix")}: {t("live.age", { age: shortAge(locale, ageMs) })}{pos.acc != null && ` · ${t("live.accuracy", { m: Math.round(pos.acc) })}`}
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label={t("live.altitude")} value={pos.alt != null ? Math.round(pos.alt) : null} unit="m" />
              <Stat label={t("live.speed")} value={pos.spd != null ? Math.round(pos.spd * 3.6) : null} unit="km/h" />
              <Stat label={t("live.battery")} value={pos.bat} unit="%" />
              <Stat label={t("live.heading")} value={pos.hdg != null ? Math.round(pos.hdg) : null} unit="°" />
            </div>
            <div className="group">
              <ActionRow icon={LocateFixed} label={props.follow ? t("live.unfollow") : t("live.follow")} active={props.follow} onClick={props.onFollow} />
              <ActionRow icon={Spline} label={props.trackShown ? t("live.hide_track") : t("live.track")} active={props.trackShown} onClick={props.onTrack} />
              <ActionRow icon={Play} label={t("live.replay")} onClick={props.onReplay} />
              <ActionRow icon={Download} label={t("live.export_gpx")} href={`/api/v1${api.events.exportPath(eventId, m.user_id, "gpx")}`} />
              <ActionRow icon={Download} label={t("live.export_igc")} href={`/api/v1${api.events.exportPath(eventId, m.user_id, "igc")}`} />
              <ActionRow icon={copied ? Check : Copy} label={copied ? t("live.copied") : t("live.copy_position")} hint={`${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}`}
                onClick={() => {
                  void navigator.clipboard.writeText(`${m.first_name} ${m.last_name}: https://maps.google.com/?q=${pos.lat.toFixed(6)},${pos.lon.toFixed(6)}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }} />
              {m.phone && <ActionRow icon={Phone} label={m.phone} href={`tel:${m.phone}`} />}
            </div>
          </>
        ) : (
          <>
            <p className="t-sub">{m.tracking ? t("live.no_position") : t("live.not_tracking")}</p>
            {m.phone && <div className="group"><ActionRow icon={Phone} label={m.phone} href={`tel:${m.phone}`} /></div>}
          </>
        )}

        {m.role === "pilot" && (
          <div className="space-y-3">
            {retrieve && (
              <div className="tile rounded-[22px] p-4">
                <div className="flex items-center justify-between">
                  <p className="t-headline">{t(`retrieve.${retrieve.status}`)}</p>
                  <span className="num t-foot">{t("live.since", { time: formatDate(locale, retrieve.requested_at, { hour: "2-digit", minute: "2-digit" }) })}</span>
                </div>
                {retrieve.note && <p className="t-sub mt-1">“{retrieve.note}”</p>}
                {retrieve.retriever_id && (
                  <p className="mt-2 flex items-center gap-2 text-[14px] font-medium"><Route size={16} className="text-label-2" />{members.get(retrieve.retriever_id) ? name(members.get(retrieve.retriever_id)!) : "?"}</p>
                )}
                {retrieve.status !== "picked_up" && (
                  <Select className="mt-3" value="" disabled={busy}
                    onChange={(e) => e.target.value && run(() => api.ops.retrieve(retrieve.id, "assign", { retriever_id: e.target.value }))}>
                    <option value="">{t("live.choose_retriever")}</option>
                    {retrievers.map((r) => (
                      <option key={r.user_id} value={r.user_id}>{name(r)} · {r.is_available ? t("live.available") : t("live.busy")}</option>
                    ))}
                  </Select>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {(retrieve.status === "assigned" || retrieve.status === "arrived") && (
                    <Button size="sm" disabled={busy} onClick={() => run(() => api.ops.retrieve(retrieve.id, "release"))}>{t("live.release")}</Button>
                  )}
                  {retrieve.status !== "picked_up" && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmCancel(true)}>{t("live.cancel_request")}</Button>
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
            <p className="t-foot">{t("live.manual_note")}</p>
            {retrieve && (
              <ConfirmDialog open={confirmCancel} onOpenChange={setConfirmCancel} danger title={t("live.cancel_request")} description={t("common.confirm")}
                confirmLabel={t("live.cancel_request")} cancelLabel={t("common.cancel")} onConfirm={() => void run(() => api.ops.retrieve(retrieve.id, "cancel", { reason: "observer" }))} />
            )}
          </div>
        )}

        {m.role === "retriever" && (
          <div className="space-y-2">
            {vehicle && <p className="t-sub">{vehicle.name}{vehicle.plate ? ` · ${vehicle.plate}` : ""} · {t("live.capacity", { used: stops.length, cap: vehicle.capacity })}</p>}
            {stops.length > 0 && (
              <div className="group">
                {stops.map((r) => {
                  const p = members.get(r.pilot_id);
                  return (
                    <div key={r.id} className="flex items-center justify-between px-4 py-3 text-[14px]">
                      <span className="font-medium">{p ? name(p) : "?"}</span>
                      <Badge>{t(`retrieve.${r.status}`)}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </div>
  );
}

function ActionRow({ icon: Ico, label, hint, active, onClick, href }: { icon: Icon; label: string; hint?: string; active?: boolean; onClick?: () => void; href?: string }) {
  const body = (
    <>
      <Ico size={18} strokeWidth={1.9} className={active ? "text-tint" : "text-label-2"} />
      <span className="min-w-0 flex-1">
        <span className={cx("block text-[15px]", active && "font-semibold")}>{label}</span>
        {hint && <span className="num t-foot block">{hint}</span>}
      </span>
      {active && <Check size={16} className="text-tint" />}
    </>
  );
  const cls = "press flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-fill-2";
  return href ? <a href={href} className={cls}>{body}</a> : <button onClick={onClick} className={cls}>{body}</button>;
}

function Stat({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div className="tile rounded-[20px] px-4 py-3.5">
      <p className="t-foot">{label}</p>
      <p className="num mt-1 flex items-baseline gap-1">
        <span className="text-[28px] font-semibold leading-none tracking-[-0.03em]">{value ?? "—"}</span>
        {value != null && <span className="text-[13px] font-medium text-label-2">{unit}</span>}
      </p>
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
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4"><div className="group">
      {items.filter((e) => LOG_KEYS[e.t]).map((e) => {
        const s = e.subject ? members.get(e.subject) : undefined;
        return (
          <div key={e.seq} className="flex gap-3 px-4 py-2.5 text-sm">
            <span className="num w-12 shrink-0 text-xs text-label-2">{formatDate(locale, new Date(e.at).toISOString(), { hour: "2-digit", minute: "2-digit" })}</span>
            <span className="min-w-0">
              <span className="block truncate">{s ? name(s) : ""}</span>
              <span className={cx("text-xs", e.t.startsWith("sos") ? "text-danger" : "text-label-2")}>{t(LOG_KEYS[e.t]!)}</span>
            </span>
          </div>
                );
      })}
      </div>
    </div>
  );
}


type TrackPoint = [number, number, number, number | null, number | null];

/** Uçuşu zaman çizelgesiyle oynatır: kaydırma çubuğu, oynat/duraklat ve hız seçimi. İz haritadaki `replay` kaynağına çizilir. */
function ReplayBar({ eventId, userId, name: who, map, onClose }: { eventId: string; userId: string; name: string; map: { current: MlMap | null }; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [pts, setPts] = useState<TrackPoint[] | null>(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(60);
  const idx = useRef(0);

  useEffect(() => {
    void api.events.track(eventId, userId).then((r) => setPts(r.points as TrackPoint[]));
    return () => {
      (map.current?.getSource("replay") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
    };
  }, [eventId, userId, map]);

  // Oynatma: gerçek zaman × hız; sıradaki noktaya ilerler.
  useEffect(() => {
    if (!pts || !playing || pts.length < 2) return;
    let raf = 0;
    let last = performance.now();
    let simT = pts[idx.current]![0];
    const tick = (now: number) => {
      simT += (now - last) * speed;
      last = now;
      let j = idx.current;
      while (j < pts.length - 1 && pts[j + 1]![0] <= simT) j++;
      if (j !== idx.current) {
        idx.current = j;
        setI(j);
      }
      if (j >= pts.length - 1) return setPlaying(false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pts, playing, speed]);

  // Çizim: geçilen yol + güncel nokta; kamera noktayı izler.
  useEffect(() => {
    const m = map.current;
    const cur = pts?.[i];
    if (!m || !pts || !cur) return;
    const done = pts.slice(0, i + 1).map((p) => [p[2], p[1]]);
    (m.getSource("replay") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [
        ...(done.length > 1 ? [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: done } }] : []),
        { type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [cur[2], cur[1]] } },
      ],
    });
    m.easeTo({ center: [cur[2], cur[1]], duration: 250, padding: PANEL_PADDING });
  }, [pts, i, map]);

  const cur = pts?.[i];
  return (
    <div className="glass absolute bottom-24 left-1/2 z-30 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-[28px] p-4">
      <div className="flex items-center gap-3">
        <IconButton label={playing ? "Pause" : "Play"} className="size-10 bg-fill" onClick={() => {
          if (pts && idx.current >= pts.length - 1) {
            idx.current = 0;
            setI(0);
          }
          setPlaying((p) => !p);
        }}>{playing ? <Pause /> : <Play />}</IconButton>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{who}</p>
          <p className="num t-foot">
            {cur ? formatDate(locale, new Date(cur[0]).toISOString(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}
            {cur?.[3] != null ? ` · ${Math.round(cur[3])} m` : ""}{cur?.[4] != null ? ` · ${Math.round(cur[4] * 3.6)} km/h` : ""}
          </p>
        </div>
        <Pills value={String(speed)} onChange={(v) => setSpeed(Number(v))} options={[{ value: "15", label: "15×" }, { value: "60", label: "60×" }, { value: "240", label: "240×" }]} />
        <IconButton label={t("live.replay_close")} className="size-9 bg-fill" onClick={onClose}><X /></IconButton>
      </div>
      {pts && pts.length < 2 ? (
        <p className="t-foot mt-3">{t("live.replay_empty")}</p>
      ) : (
        <input type="range" min={0} max={Math.max(0, (pts?.length ?? 1) - 1)} value={i} aria-label="Replay position"
          onChange={(e) => {
            idx.current = Number(e.target.value);
            setI(idx.current);
          }}
          className="mt-3 h-2 w-full cursor-pointer accent-[var(--tint-fill)]" />
      )}
    </div>
  );
}
