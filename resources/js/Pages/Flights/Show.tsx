import React, { useState } from 'react';
import { Head, Link, router } from '@inertiajs/react';
import { Layout } from '../../Components/Layout';
import { Badge } from '../../Components/Badge';
import { Flight, FlightEvent } from '../../types';

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

export default function FlightShow({ flight, route }: Props) {
  const [confirming, setConfirming] = useState(false);
  const mapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!mapRef.current || route.length === 0) return;
    let map: any = null;
    import('leaflet').then(L => {
      const latlngs = route.map(p => [p.lat, p.lng] as [number, number]);
      map = L.default.map(mapRef.current!, { center: latlngs[0], zoom: 12 });
      L.default.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);
      L.default.polyline(latlngs, { color: '#2563eb', weight: 3 }).addTo(map);
      map.fitBounds(L.default.latLngBounds(latlngs));
    });
    return () => { map?.remove(); };
  }, [route]);

  const adminComplete = () => {
    router.patch(`/flights/${flight.id}/complete`, {}, { onSuccess: () => setConfirming(false) });
  };

  return (
    <Layout>
      <Head title={`Uçuş #${flight.flight_number}`} />
      <div className="p-6 max-w-4xl space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {flight.event && (
                <Link href={`/events/${flight.event.id}/flights`} className="text-sm text-gray-500 hover:text-gray-700">
                  ← {flight.event.name}
                </Link>
              )}
            </div>
            <h1 className="text-xl font-semibold text-gray-900">Uçuş #{flight.flight_number}</h1>
            <p className="text-sm text-gray-500">{flight.pilot?.name}</p>
          </div>
          <Badge variant={statusVariant[flight.status]}>{statusLabel[flight.status]}</Badge>
        </div>

        {/* Force complete */}
        {['flying', 'landed', 'sos'].includes(flight.status) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-center justify-between">
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
                <button onClick={() => setConfirming(false)}
                  className="text-xs text-gray-500 hover:text-gray-700">İptal</button>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Flight info */}
          <div className="rounded-xl border border-gray-100 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Uçuş Bilgileri</h2>
            <dl className="space-y-2">
              {[
                ['Pilot', flight.pilot?.name ?? '—'],
                ['Telefon', flight.pilot?.phone ?? '—'],
                ['Başlangıç', new Date(flight.started_at).toLocaleString('tr-TR')],
                ['İniş', flight.landed_at ? new Date(flight.landed_at).toLocaleString('tr-TR') : '—'],
                ['Tamamlanma', flight.completed_at ? new Date(flight.completed_at).toLocaleString('tr-TR') : '—'],
                ['Konum Noktası', route.length.toString()],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                  <dt className="text-xs text-gray-500">{label}</dt>
                  <dd className="text-sm font-medium text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Retrieval info */}
          {flight.retrieval_request && (
            <div className="rounded-xl border border-gray-100 bg-white p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Retrieval</h2>
              <dl className="space-y-2">
                {[
                  ['Durum', flight.retrieval_request.status],
                  ['Retriever', flight.retrieval_request.retriever?.name ?? 'Atanmadı'],
                  ['Bırakma Noktası', flight.retrieval_request.drop_off_point?.name ?? '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                    <dt className="text-xs text-gray-500">{label}</dt>
                    <dd className="text-sm font-medium text-gray-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        {/* Map */}
        {route.length > 0 && (
          <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
            <div className="border-b border-gray-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Uçuş Rotası</h2>
            </div>
            <div ref={mapRef} className="h-80 w-full" />
          </div>
        )}

        {/* Events timeline */}
        {flight.flight_events && flight.flight_events.length > 0 && (
          <div className="rounded-xl border border-gray-100 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Olay Geçmişi</h2>
            <div className="space-y-3">
              {flight.flight_events.map(ev => (
                <div key={ev.id} className="flex items-start gap-3">
                  <div className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-400" />
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
