import React, { useState, useRef, useEffect } from 'react';
import { Head, Link, router } from '@inertiajs/react';
import { Layout } from '../../Components/Layout';
import { Badge } from '../../Components/Badge';
import { Flight, FlightEvent } from '../../types';
import { Layers } from 'lucide-react';

const statusVariant: Record<Flight['status'], 'default' | 'success' | 'warning' | 'danger'> = {
  flying: 'success', landed: 'warning', sos: 'danger', completed: 'default',
};
const statusLabel: Record<Flight['status'], string> = {
  flying: 'Uçuşta', landed: 'İndi', sos: 'SOS', completed: 'Tamamlandı',
};

interface LocationPoint {
  lat: number;
  lng: number;
  altitude?: number;
  speed?: number;
  recorded_at: string;
}

interface Props {
  flight: Flight & {
    event?: { id: string; name: string };
    flight_events?: FlightEvent[];
    retrieval_request?: any;
  };
  route: LocationPoint[];
}

const TILES = [
  {
    id: 'topo',
    label: 'Topografya',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 17,
  },
  {
    id: 'osm',
    label: 'Standart',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
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
    attribution: '© <a href="https://carto.com/">CARTO</a>',
    maxZoom: 20,
  },
  {
    id: 'dark',
    label: 'Koyu',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© <a href="https://carto.com/">CARTO</a>',
    maxZoom: 20,
  },
] as const;

type TileId = typeof TILES[number]['id'];

export default function FlightShow({ flight, route }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [activeTile, setActiveTile] = useState<TileId>('topo');
  const [showTilePicker, setShowTilePicker] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current || route.length === 0) return;

    import('leaflet').then(L => {
      if (mapInstance.current) return;
      const latlngs = route.map(p => [p.lat, p.lng] as [number, number]);
      const map = L.default.map(mapRef.current!, { center: latlngs[0], zoom: 12 });

      const tile = TILES.find(t => t.id === activeTile) ?? TILES[0];
      tileLayerRef.current = L.default.tileLayer(tile.url, {
        attribution: tile.attribution,
        maxZoom: tile.maxZoom,
      }).addTo(map);

      L.default.polyline(latlngs, { color: '#2563eb', weight: 3, opacity: 0.85 }).addTo(map);

      // Start marker (green)
      L.default.circleMarker(latlngs[0], { radius: 7, color: '#16a34a', fillColor: '#16a34a', fillOpacity: 1 })
        .addTo(map)
        .bindTooltip('Kalkış');

      // End marker (red or blue)
      const last = latlngs[latlngs.length - 1];
      L.default.circleMarker(last, { radius: 7, color: '#dc2626', fillColor: '#dc2626', fillOpacity: 1 })
        .addTo(map)
        .bindTooltip('Son Konum');

      map.fitBounds(L.default.latLngBounds(latlngs), { padding: [30, 30] });
      mapInstance.current = map;
    });

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
      tileLayerRef.current = null;
    };
  }, [route]);

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

  const adminComplete = () => {
    router.patch(`/flights/${flight.id}/complete`, {}, { onSuccess: () => setConfirming(false) });
  };

  return (
    <Layout>
      <Head title={`Uçuş #${flight.flight_number}`} />
      <div className="p-6 max-w-4xl space-y-6">
        <div className="flex items-start justify-between">
          <div>
            {flight.event && (
              <Link href={`/events/${flight.event.id}/flights`} className="text-sm text-gray-500 hover:text-gray-700">
                ← {flight.event.name}
              </Link>
            )}
            <h1 className="mt-1 text-xl font-semibold text-gray-900">Uçuş #{flight.flight_number}</h1>
            <p className="text-sm text-gray-500">{flight.pilot?.name}</p>
          </div>
          <Badge variant={statusVariant[flight.status]}>{statusLabel[flight.status]}</Badge>
        </div>

        {/* Force complete banner */}
        {['flying', 'landed', 'sos'].includes(flight.status) && (
          <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-800">Bu uçuş hâlâ aktif. Yönetici olarak tamamlayabilirsiniz.</p>
            {!confirming ? (
              <button onClick={() => setConfirming(true)}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">
                Tamamla
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-700">Emin misiniz?</span>
                <button onClick={adminComplete}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">
                  Evet, Tamamla
                </button>
                <button onClick={() => setConfirming(false)} className="text-xs text-gray-500 hover:text-gray-700">İptal</button>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Flight info */}
          <div className="rounded-xl border border-gray-100 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Uçuş Bilgileri</h2>
            <dl className="space-y-2">
              {[
                ['Pilot', flight.pilot?.name ?? '—'],
                ['Telefon', (flight.pilot as any)?.phone ?? '—'],
                ['Başlangıç', new Date(flight.started_at).toLocaleString('tr-TR')],
                ['İniş', flight.landed_at ? new Date(flight.landed_at).toLocaleString('tr-TR') : '—'],
                ['Tamamlanma', flight.completed_at ? new Date(flight.completed_at).toLocaleString('tr-TR') : '—'],
                ['Konum Noktası', route.length.toString()],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between border-b border-gray-50 py-1 last:border-0">
                  <dt className="text-xs text-gray-500">{label}</dt>
                  <dd className="text-sm font-medium text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Retrieval info */}
          {flight.retrieval_request && (
            <div className="rounded-xl border border-gray-100 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Retrieval</h2>
              <dl className="space-y-2">
                {[
                  ['Durum', flight.retrieval_request.status],
                  ['Retriever', flight.retrieval_request.retriever?.name ?? 'Atanmadı'],
                  ['Bırakma Noktası', flight.retrieval_request.drop_off_point?.name ?? '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between border-b border-gray-50 py-1 last:border-0">
                    <dt className="text-xs text-gray-500">{label}</dt>
                    <dd className="text-sm font-medium text-gray-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        {/* Route map */}
        {route.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
            <div className="border-b border-gray-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Uçuş Rotası</h2>
            </div>
            <div className="relative">
              <div ref={mapRef} className="h-96 w-full" />

              {/* Tile picker */}
              <div className="absolute bottom-4 right-3 z-[1000]">
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
                        <span className={`h-1.5 w-1.5 rounded-full ${activeTile === tile.id ? 'bg-blue-600' : 'bg-transparent'}`} />
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
        )}

        {/* Events timeline */}
        {flight.flight_events && flight.flight_events.length > 0 && (
          <div className="rounded-xl border border-gray-100 bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Olay Geçmişi</h2>
            <div className="space-y-3">
              {flight.flight_events.map(ev => (
                <div key={ev.id} className="flex items-start gap-3">
                  <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-400" />
                  <div className="flex-1">
                    <p className="text-sm text-gray-900">{ev.message}</p>
                    <p className="text-xs text-gray-400">{new Date(ev.created_at).toLocaleString('tr-TR')}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
