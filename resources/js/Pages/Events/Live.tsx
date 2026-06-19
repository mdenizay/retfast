import React, { useEffect, useRef, useState } from 'react';
import { Head } from '@inertiajs/react';
import { Layout } from '../../Components/Layout';
import { Badge } from '../../Components/Badge';
import { Event, Flight, User } from '../../types';

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

export default function EventLive({ event }: { event: Event }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});
  const [pilots, setPilots] = useState<LiveFlight[]>([]);
  const [retrievers, setRetrievers] = useState<LiveRetriever[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

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
      .catch(() => {
        // Silently ignore snapshot fetch errors (e.g., not yet implemented)
      });
  }, [event.id]);

  // Init Leaflet map
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    import('leaflet').then(L => {
      const map = L.default.map(mapRef.current!, {
        center: [event.map_center_lat ?? 38.4, event.map_center_lng ?? 27.1],
        zoom: event.map_zoom ?? 10,
      });
      L.default.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);
      mapInstance.current = map;
    });

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  // Update markers when pilots change
  useEffect(() => {
    if (!mapInstance.current) return;
    import('leaflet').then(L => {
      pilots.forEach(flight => {
        if (!flight.current_location) return;
        const { lat, lng } = flight.current_location;
        const color = flight.status === 'sos' ? '#ef4444' : flight.status === 'flying' ? '#2563eb' : '#f59e0b';
        const icon = L.default.divIcon({
          html: `<div style="background:${color};width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.3)"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
          className: '',
        });
        if (markersRef.current[flight.id]) {
          markersRef.current[flight.id].setLatLng([lat, lng]).setIcon(icon);
        } else {
          const marker = L.default.marker([lat, lng], { icon })
            .addTo(mapInstance.current)
            .bindTooltip(`${flight.pilot?.name ?? 'Pilot'} — Uçuş #${flight.flight_number}`);
          markersRef.current[flight.id] = marker;
        }
      });
    });
  }, [pilots]);

  // WebSocket via Echo (if window.Echo is available)
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

    return () => {
      Echo.leave(`event.${event.id}`);
    };
  }, [event.id]);

  const activePilots = pilots.filter(p => p.status !== 'completed');

  return (
    <Layout>
      <Head title={`Canlı: ${event.name}`} />
      <div className="flex h-full">
        {/* Sidebar panel */}
        <div className="w-72 flex-shrink-0 overflow-auto border-r border-gray-100 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">{event.name}</h2>
            <p className="text-xs text-gray-500">{activePilots.length} aktif uçuş</p>
          </div>

          {/* Pilots */}
          <div className="px-3 py-2">
            <p className="mb-2 text-xs font-medium text-gray-400 uppercase tracking-wide">Pilotlar</p>
            {activePilots.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">Aktif uçuş yok</p>
            ) : activePilots.map(flight => (
              <button
                key={flight.id}
                onClick={() => {
                  setSelected(flight.id);
                  if (flight.current_location && mapInstance.current) {
                    mapInstance.current.setView([flight.current_location.lat, flight.current_location.lng], 14);
                  }
                }}
                className={`w-full text-left rounded-lg p-2.5 mb-1.5 border transition-colors ${selected === flight.id ? 'border-blue-200 bg-blue-50' : 'border-transparent hover:bg-gray-50'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">{flight.pilot?.name ?? 'Pilot'}</span>
                  <Badge variant={statusVariant[flight.status]}>{statusLabel[flight.status]}</Badge>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">Uçuş #{flight.flight_number}</p>
                {flight.current_location && (
                  <p className="text-xs text-gray-400">
                    {flight.current_location.altitude != null ? `${Math.round(flight.current_location.altitude)}m` : ''}
                    {flight.current_location.speed != null ? ` · ${Math.round(flight.current_location.speed)}km/h` : ''}
                  </p>
                )}
              </button>
            ))}
          </div>

          {/* Retrievers */}
          {retrievers.length > 0 && (
            <div className="px-3 py-2 border-t border-gray-100">
              <p className="mb-2 text-xs font-medium text-gray-400 uppercase tracking-wide">Retrieverlar</p>
              {retrievers.map(r => (
                <div key={r.user_id} className="rounded-lg border border-transparent p-2.5 mb-1">
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
        <div className="flex-1 relative">
          <div ref={mapRef} className="h-full w-full" />
        </div>
      </div>
    </Layout>
  );
}
