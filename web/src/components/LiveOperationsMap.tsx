import {
  BatteryMedium,
  ChevronDown,
  Gauge,
  MapPin,
  PanelRightOpen,
  Radio,
  Signal,
  Users,
  X,
} from "lucide-react";
import { divIcon, latLngBounds } from "leaflet";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LayersControl,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

import { useLocale } from "../i18n";
import { useLiveParticipants, type LiveParticipant } from "../lib/live";
import { RetrievalOperationsBoard } from "./RetrievalOperationsBoard";
import { FlightReplayPanel } from "./FlightReplayPanel";

function markerIcon(participant: LiveParticipant) {
  const heading = Number.isFinite(participant.heading) ? participant.heading ?? 0 : 0;
  return divIcon({
    className: "retfast-map-marker-wrap",
    html: `<span class="retfast-map-marker ${participant.role} ${participant.online ? "online" : "offline"}" style="--heading:${heading}deg"><i></i></span>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function FitParticipants({ participants }: { participants: LiveParticipant[] }) {
  const map = useMap();
  const coordinateKey = participants
    .map((participant) => `${participant.userId}:${participant.latitude}:${participant.longitude}`)
    .join("|");
  useEffect(() => {
    if (participants.length === 0) return;
    if (participants.length === 1) {
      map.flyTo([participants[0]!.latitude, participants[0]!.longitude], 14, {
        duration: 0.6,
      });
      return;
    }
    map.fitBounds(
      latLngBounds(
        participants.map((participant) => [participant.latitude, participant.longitude]),
      ),
      { padding: [45, 45], maxZoom: 15 },
    );
  }, [coordinateKey, map, participants]);
  return null;
}

export function LiveOperationsMap({
  eventId,
  eventOverlay,
}: {
  eventId: string;
  eventOverlay?: ReactNode;
}) {
  const { copy } = useLocale();
  const { participants, connected, loading, error } = useLiveParticipants(eventId, true);
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const sorted = useMemo(
    () => [...participants].sort((left, right) => Number(right.online) - Number(left.online)),
    [participants],
  );
  const online = sorted.filter((participant) => participant.online);
  const pilots = online.filter((participant) => participant.role === "pilot").length;
  const retrievers = online.filter((participant) => participant.role === "retriever").length;

  return (
    <section className="live-operations-panel">
      <div className="live-map-stage">
        <div className="live-map-frame">
          <MapContainer center={[39, 35]} zoom={6} scrollWheelZoom className="live-leaflet-map">
            <LayersControl position="topright">
              <LayersControl.BaseLayer checked name={copy.streetMap}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  maxZoom={19}
                />
              </LayersControl.BaseLayer>
              <LayersControl.BaseLayer name={copy.terrainMap}>
                <TileLayer
                  attribution='Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, style &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
                  url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
                  maxZoom={17}
                />
              </LayersControl.BaseLayer>
            </LayersControl>
            {sorted.map((participant) => (
              <Marker
                key={participant.userId}
                position={[participant.latitude, participant.longitude]}
                icon={markerIcon(participant)}
              >
                <Popup>
                  <div className="map-popup">
                    <strong>{participant.displayName}</strong>
                    <span>{copy[participant.role]}{participant.radioCallsign ? ` · ${participant.radioCallsign}` : ""}</span>
                    <span>{Math.round(participant.altitude ?? 0)} m · {Math.round((participant.speed ?? 0) * 3.6)} km/h</span>
                  </div>
                </Popup>
              </Marker>
            ))}
            <FitParticipants participants={online} />
          </MapContainer>
          {loading && <div className="map-empty-overlay"><span className="content-loader"><i />{copy.loadingLive}</span></div>}
          {!loading && sorted.length === 0 && <div className="map-empty-overlay"><MapPin /><strong>{copy.noLiveLocations}</strong><span>{copy.noLiveLocationsHint}</span></div>}
        </div>

        {eventOverlay && <div className="map-event-overlay">{eventOverlay}</div>}

        <div className="map-live-tools">
          <div className={`live-connection ${connected ? "connected" : "disconnected"}`}>
            <i />
            {connected ? copy.connected : copy.offline}
          </div>
          <button className="telemetry-toggle" type="button" onClick={() => setTelemetryOpen(true)}>
            <PanelRightOpen />
            <span>{copy.liveTelemetry}</span>
            <strong>{sorted.length}</strong>
          </button>
        </div>

        <div className="live-summary-grid map-summary-overlay">
          <article><Users /><span><small>{copy.onlineTeam}</small><strong>{online.length}</strong></span></article>
          <article><MapPin /><span><small>{copy.pilotsInFlight}</small><strong>{pilots}</strong></span></article>
          <article><Radio /><span><small>{copy.activeRetrievers}</small><strong>{retrievers}</strong></span></article>
        </div>

        <a className="map-scroll-cue" href="#event-operations">
          <span>{copy.scrollForOperations}</span>
          <ChevronDown />
        </a>

        {telemetryOpen && (
          <div className="telemetry-scrim" role="presentation" onMouseDown={() => setTelemetryOpen(false)}>
            <aside className="telemetry-panel telemetry-drawer" role="dialog" aria-modal="true" aria-label={copy.liveTelemetry} onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}>
              <div className="telemetry-heading">
                <span>{copy.liveTelemetry}</span>
                <div><strong>{sorted.length}</strong><button type="button" aria-label={copy.close} onClick={() => setTelemetryOpen(false)}><X /></button></div>
              </div>
              {error && <div className="telemetry-error">{copy.realtimeUnavailable}</div>}
              <div className="telemetry-list">
                {sorted.map((participant) => (
                  <article className="telemetry-person" key={participant.userId}>
                    <div className={`telemetry-avatar ${participant.role}`}>{participant.displayName.slice(0, 2).toUpperCase()}<i className={participant.online ? "online" : "offline"} /></div>
                    <div className="telemetry-identity"><strong>{participant.displayName}</strong><small>{copy[participant.role]}{participant.radioCallsign ? ` · ${participant.radioCallsign}` : ""}</small></div>
                    <div className="telemetry-values">
                      <span title={copy.speed}><Gauge />{Math.round((participant.speed ?? 0) * 3.6)} <small>km/h</small></span>
                      <span title={copy.altitude}><MapPin />{Math.round(participant.altitude ?? 0)} <small>m</small></span>
                      <span title={copy.battery}><BatteryMedium />{participant.batteryLevel == null ? "—" : Math.round(participant.batteryLevel * 100)}<small>%</small></span>
                      <span title={copy.connection}><Signal />{copy[participant.connectivity]}</span>
                    </div>
                  </article>
                ))}
              </div>
            </aside>
          </div>
        )}
      </div>

      <div className="operations-scroll-content" id="event-operations">
        <div className="live-operations-heading">
          <div>
            <span className="section-kicker">{copy.liveOperations}</span>
            <h2>{copy.eventOperations}</h2>
            <p>{copy.liveOperationsHint}</p>
          </div>
        </div>
        <RetrievalOperationsBoard eventId={eventId} participants={sorted} />
        <FlightReplayPanel eventId={eventId} />
      </div>
    </section>
  );
}
