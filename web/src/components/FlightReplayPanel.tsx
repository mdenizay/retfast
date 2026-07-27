import {
  BatteryMedium,
  Clock3,
  Gauge,
  MapPin,
  Pause,
  Play,
  Radio,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { divIcon, latLngBounds } from "leaflet";
import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
} from "react-leaflet";

import { useLocale } from "../i18n";
import {
  loadReplayPoints,
  useReplaySessions,
  type ReplayPoint,
} from "../lib/replay";

const replayMarker = divIcon({
  className: "replay-marker-wrap",
  html: '<span class="replay-marker"><i></i></span>',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

function FitReplay({ points }: { points: ReplayPoint[] }) {
  const map = useMap();
  const routeKey = points.length
    ? `${points[0]!.latitude}:${points[0]!.longitude}:${points.at(-1)!.latitude}:${points.at(-1)!.longitude}`
    : "";
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView([points[0]!.latitude, points[0]!.longitude], 14);
      return;
    }
    map.fitBounds(
      latLngBounds(points.map((point) => [point.latitude, point.longitude])),
      { padding: [35, 35], maxZoom: 15 },
    );
  }, [map, points, routeKey]);
  return null;
}

export function FlightReplayPanel({ eventId }: { eventId: string }) {
  const { copy, locale } = useLocale();
  const { sessions, loading: loadingSessions } = useReplaySessions(eventId);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [points, setPoints] = useState<ReplayPoint[]>([]);
  const [pointIndex, setPointIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const activeSessionId = selectedSessionId || sessions[0]?.id || "";
  const selectedSession = sessions.find((session) => session.id === activeSessionId);

  useEffect(() => {
    if (!activeSessionId) return;
    let active = true;
    void loadReplayPoints(activeSessionId).then((nextPoints) => {
      if (!active) return;
      setPoints(nextPoints);
      setPointIndex(0);
      setPlaying(false);
    }).catch(() => {
      if (active) setPoints([]);
    });
    return () => {
      active = false;
    };
  }, [activeSessionId]);

  useEffect(() => {
    if (!playing || points.length < 2) return;
    const interval = window.setInterval(() => {
      setPointIndex((current) => {
        if (current >= points.length - 1) {
          window.clearInterval(interval);
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 500);
    return () => window.clearInterval(interval);
  }, [playing, points.length]);

  const currentPoint = points[Math.min(pointIndex, points.length - 1)];
  const visibleRoute = useMemo(
    () => points.slice(0, pointIndex + 1).map((point) => [point.latitude, point.longitude] as [number, number]),
    [pointIndex, points],
  );
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "medium",
    }),
    [locale],
  );

  return (
    <section className="flight-replay-panel">
      <div className="replay-heading">
        <div>
          <span className="section-kicker">{copy.flightReplay}</span>
          <h3>{copy.replayTimeline}</h3>
          <p>{copy.flightReplayHint}</p>
        </div>
        <label className="replay-session-select">
          <span>{copy.selectFlight}</span>
          <select
            value={activeSessionId}
            onChange={(event) => {
              setSelectedSessionId(event.target.value);
              setPoints([]);
              setPointIndex(0);
              setPlaying(false);
            }}
          >
            {sessions.length === 0 && <option value="">{copy.noFlights}</option>}
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.displayName} · {session.startedAt ? timeFormatter.format(session.startedAt.toDate()) : "—"}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="replay-layout">
        <div className="replay-map-frame">
          <MapContainer center={[39, 35]} zoom={6} className="replay-leaflet-map">
            <TileLayer
              attribution='Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, style &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
              url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
              maxZoom={17}
            />
            {visibleRoute.length > 1 && <Polyline positions={visibleRoute} pathOptions={{ color: "#146c5c", weight: 4, opacity: 0.86 }} />}
            {currentPoint && <Marker position={[currentPoint.latitude, currentPoint.longitude]} icon={replayMarker} />}
            <FitReplay points={points} />
          </MapContainer>
          {!loadingSessions && !points.length && <div className="replay-empty"><MapPin /><strong>{sessions.length ? copy.noTrackPoints : copy.noFlights}</strong></div>}
        </div>

        <aside className="replay-console">
          <div className="replay-pilot"><span>{selectedSession?.displayName.slice(0, 2).toUpperCase() || "—"}</span><div><strong>{selectedSession?.displayName ?? copy.noFlights}</strong><small>{selectedSession?.radioCallsign || selectedSession?.status || "—"}</small></div></div>
          <div className="replay-metrics">
            <article><Gauge /><span><small>{copy.speed}</small><strong>{Math.round((currentPoint?.speed ?? 0) * 3.6)} km/h</strong></span></article>
            <article><MapPin /><span><small>{copy.altitude}</small><strong>{Math.round(currentPoint?.altitude ?? 0)} m</strong></span></article>
            <article><BatteryMedium /><span><small>{copy.battery}</small><strong>{currentPoint?.batteryLevel == null ? "—" : `${Math.round(currentPoint.batteryLevel * 100)}%`}</strong></span></article>
            <article><Radio /><span><small>{copy.trackPoints}</small><strong>{points.length}</strong></span></article>
          </div>
          <div className="replay-time"><Clock3 /><span>{currentPoint ? timeFormatter.format(new Date(currentPoint.recordedAt)) : "—"}</span></div>
          <input
            aria-label={copy.replayTimeline}
            type="range"
            min="0"
            max={Math.max(0, points.length - 1)}
            value={Math.min(pointIndex, Math.max(0, points.length - 1))}
            disabled={points.length < 2}
            onChange={(event) => {
              setPlaying(false);
              setPointIndex(Number(event.target.value));
            }}
          />
          <div className="replay-controls">
            <button type="button" disabled={!points.length} onClick={() => { setPlaying(false); setPointIndex(0); }}><SkipBack />{copy.replayStart}</button>
            <button className="replay-play" type="button" disabled={points.length < 2} onClick={() => setPlaying((current) => !current)}>{playing ? <Pause /> : <Play />}{playing ? copy.pause : copy.play}</button>
            <button type="button" disabled={!points.length} onClick={() => { setPlaying(false); setPointIndex(Math.max(0, points.length - 1)); }}>{copy.replayEnd}<SkipForward /></button>
          </div>
        </aside>
      </div>
    </section>
  );
}
