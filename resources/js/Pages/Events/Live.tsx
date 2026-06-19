import React, { useEffect, useRef, useState } from 'react';
import { Head } from '@inertiajs/react';
import { Layout } from '../../Components/Layout';
import { Badge } from '../../Components/Badge';
import { Event, Flight, User } from '../../types';
import { Layers } from 'lucide-react';

interface LiveFlight {
  id: string;
  pilot_id: string;
  status: Flight['status'];
  flight_number: number;
  pilot?: Pick<User, 'id' | 'name' | 'avatar_url'>;
  current_location?: {
    lat: number;
    lng: number;
    altitude?: number;
    speed?: number;
    heading?: number;
    recorded_at: string;
  } | null;
}

interface LiveRetriever {
  user_id: string;
  retriever?: Pick<User, 'id' | 'name' | 'avatar_url'>;
  is_available: boolean;
  lat?: number;
  lng?: number;
  location_updated_at?: string;
}

const statusVariant: Record<Flight['status'], 'default' | 'success' | 'warning' | 'danger'> = {
  flying: 'success', landed: 'warning', sos: 'danger', completed: 'default',
};
const statusLabel: Record<Flight['status'], string> = {
  flying: 'Uçuşta', landed: 'İndi', sos: 'SOS', completed: 'Tamamlandı',
};

const TILES = [
  {
    id: 'osm',
    label: 'Standart',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
  {
    id: 'topo',
    label: 'Topografya',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 17,
  },
  {
    id: 'satellite',
    label: 'Uydu',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© <a href="https://www.esri.com">Esri</a>',
    maxZoom: 19,
  },
  {
    id: 'light',
    label: 'Açık',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
    maxZoom: 20,
  },
  {
    id: 'dark',
    label: 'Koyu',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
    maxZoom: 20,
  },
] as const;

type TileId = typeof TILES[number]['id'];

export default function EventLive({ event }: { event: Event }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});
  const [pilots, setPilots] = useState<LiveFlight[]>([]);
  const [retrievers, setRetrievers] = useState<LiveRetriever[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeTile, setActiveTile] = useState<TileId>('topo');
  const [showTilePicker, setShowTilePicker] = useState(false);

  // Load initial snapshot
  useEffect(() => {
    fetch(`/api/live/${event.id}/snapshot`, {
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    })
      .then(r => r.json())
      .then(data => {
        setPilots(data.pilots ?? []);
        setRetrievers(data.retrievers ?? []);
      })
      .catch(() => {});
  }, [event.id]);

  // Init Leaflet map
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    import('leaflet').then(L => {
      const map = L.default.map(mapRef.current!, {
        center: [event.map_center_lat ?? 37.53, event.map_center_lng ?? 29.10],
        zoom: event.map_zoom ?? 11,
        zoomControl: true,
      });

      const tile = TILES.find(t => t.id === activeTile) ?? TILES[1];
      tileLayerRef.current = L.default.tileLayer(tile.url, {
        attribution: tile.attribution,
        maxZoom: tile.maxZoom,
      }).addTo(map);

      mapInstance.current = map;
    });

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  // Switch tile layer
  useEffect(() => {
    if (!mapInstance.current || !tileLayerRef.current) return;
    import('leaflet').then(L => {
      const tile = TILES.find(t => t.id === activeTile)!;
      mapInstance.current.removeLayer(tileLayerRef.current);
      tileLayerRef.current = L.default.tileLayer(tile.url, {
        attribution: tile.attribution,
        maxZoom: tile.maxZoom,
      }).addTo(mapInstance.current);
    });
  }, [activeTile]);

  // Update pilot markers
  useEffect(() => {
    if (!mapInstance.current) return;
    import('leaflet').then(L => {
      pilots.forEach(flight => {
        if (!flight.current_location) return;
        const { lat, lng } = flight.current_location;
        const color = flight.status === 'sos' ? '#ef4444' : flight.status === 'flying' ? '#2563eb' : '#f59e0b';
        const isSelected = selected === flight.id;
        const icon = L.default.divIcon({
          html: `<div style="background:${color};width:${isSelected ? 16 : 12}px;height:${isSelected ? 16 : 12}px;border-radius:50%;border:2px solid white;box-shadow:0 0 ${isSelected ? 8 : 4}px rgba(0,0,0,0.4);transition:all .2s"></div>`,
          iconSize: [isSelected ? 16 : 12, isSelected ? 16 : 12],
          iconAnchor: [isSelected ? 8 : 6, isSelected ? 8 : 6],
          className: '',
        });
        if (markersRef.current[flight.id]) {
          markersRef.current[flight.id].setLatLng([lat, lng]).setIcon(icon);
        } else {
          const marker = L.default.marker([lat, lng], { icon })
            .addTo(mapInstance.current)
            .bindTooltip(`${flight.pilot?.name ?? 'Pilot'} — Uçuş #${flight.flight_number}`, { permanent: false });
          markersRef.current[flight.id] = marker;
        }
      });
    });
  }, [pilots, selected]);

  // WebSocket via Echo
  useEffect(() => {
    const Echo = (window as any).Echo;
    if (!Echo) return;
    const channel = Echo.private(`event.${event.id}`);
    channel.listen('.flight.status', (data: any) => {
      setPilots(prev => {
        const idx = prev.findIndex(p => p.id === data.id);
        if (idx === -1) return [...prev, data];
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...data };
        return updated;
      });
    });
    channel.listen('.pilot.location', (data: any) => {
      setPilots(prev => prev.map(p =>
        p.id === data.flight_id ? { ...p, current_location: data.location } : p
      ));
    });
    channel.listen('.retriever.location', (data: any) => {
      setRetrievers(prev => prev.map(r =>
        r.user_id === data.user_id ? { ...r, lat: data.lat, lng: data.lng } : r
      ));
    });
    return () => { Echo.leave(`event.${event.id}`); };
  }, [event.id]);

  const activePilots = pilots.filter(p => p.status !== 'completed');

  return (
    <Layout fullHeight>
      <Head title={`Canlı: ${event.name}`} />
      <div className="flex h-full">
        {/* Sidebar */}
        <div className="w-72 flex-shrink-0 overflow-y-auto border-r border-gray-100 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">{event.name}</h2>
            <p className="text-xs text-gray-500">{activePilots.length} aktif uçuş</p>
          </div>

          <div className="px-3 py-2">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Pilotlar</p>
            {activePilots.length === 0 ? (
              <p className="py-4 text-center text-xs text-gray-400">Aktif uçuş yok</p>
            ) : activePilots.map(flight => (
              <button
                key={flight.id}
                onClick={() => {
                  setSelected(flight.id);
                  if (flight.current_location && mapInstance.current) {
                    mapInstance.current.setView([flight.current_location.lat, flight.current_location.lng], 14);
                  }
                }}
                className={`mb-1.5 w-full rounded-lg border p-2.5 text-left transition-colors ${
                  selected === flight.id ? 'border-blue-200 bg-blue-50' : 'border-transparent hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">{flight.pilot?.name ?? 'Pilot'}</span>
                  <Badge variant={statusVariant[flight.status]}>{statusLabel[flight.status]}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-gray-400">Uçuş #{flight.flight_number}</p>
                {flight.current_location && (
                  <p className="text-xs text-gray-400">
                    {flight.current_location.altitude != null ? `${Math.round(flight.current_location.altitude)} m` : ''}
                    {flight.current_location.speed != null ? ` · ${Math.round(flight.current_location.speed)} km/h` : ''}
                  </p>
                )}
              </button>
            ))}
          </div>

          {retrievers.length > 0 && (
            <div className="border-t border-gray-100 px-3 py-2">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Retrieverlar</p>
              {retrievers.map(r => (
                <div key={r.user_id} className="mb-1 rounded-lg p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{r.retriever?.name ?? 'Retriever'}</span>
                    <Badge variant={r.is_available ? 'success' : 'default'}>
                      {r.is_available ? 'Müsait' : 'Meşgul'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Map */}
        <div className="relative flex-1">
          <div ref={mapRef} className="h-full w-full" />

          {/* Tile picker */}
          <div className="absolute bottom-5 right-3 z-[1000]">
            {showTilePicker && (
              <div className="mb-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                {TILES.map(tile => (
                  <button
                    key={tile.id}
                    onClick={() => { setActiveTile(tile.id); setShowTilePicker(false); }}
                    className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 ${
                      activeTile === tile.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-700'
                    }`}
                  >
                    {activeTile === tile.id && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />}
                    {activeTile !== tile.id && <span className="h-1.5 w-1.5" />}
                    {tile.label}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowTilePicker(v => !v)}
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-md hover:bg-gray-50"
            >
              <Layers className="h-4 w-4" />
              {TILES.find(t => t.id === activeTile)?.label}
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
