import React, { useState } from 'react';
import { Head, Link, router } from '@inertiajs/react';
import { Layout } from '../../Components/Layout';
import { Badge } from '../../Components/Badge';
import { Event, Flight } from '../../types';

const statusVariant: Record<Flight['status'], 'default' | 'success' | 'warning' | 'danger'> = {
  flying: 'success', landed: 'warning', sos: 'danger', completed: 'default',
};
const statusLabel: Record<Flight['status'], string> = {
  flying: 'Uçuşta', landed: 'İndi', sos: 'SOS', completed: 'Tamamlandı',
};

type Filter = 'all' | 'flying' | 'sos' | 'landed' | 'completed';

export default function FlightsIndex({ event, flights }: { event: Event; flights: Flight[] }) {
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = filter === 'all' ? flights : flights.filter(f => f.status === filter);

  return (
    <Layout>
      <Head title={`Uçuşlar: ${event.name}`} />
      <div className="p-6">
        <div className="mb-4 flex items-center gap-3">
          <Link href={`/events/${event.id}`} className="text-sm text-gray-500 hover:text-gray-700">← {event.name}</Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-xl font-semibold text-gray-900">Uçuşlar</h1>
        </div>

        {/* Filter tabs */}
        <div className="mb-4 flex items-center gap-1 rounded-md border border-gray-200 bg-white p-0.5 w-fit">
          {(['all', 'flying', 'sos', 'landed', 'completed'] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${filter === f ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-900'}`}>
              {f === 'all' ? 'Tümü' : statusLabel[f as Flight['status']]}
              {' '}({f === 'all' ? flights.length : flights.filter(fl => fl.status === f).length})
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-gray-100 bg-white">
          {filtered.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-gray-400">Uçuş bulunamadı</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">#</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Pilot</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Durum</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Başlangıç</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Konum Sayısı</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(flight => (
                  <tr key={flight.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">#{flight.flight_number}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{flight.pilot?.name}</p>
                      <p className="text-xs text-gray-400">{flight.pilot?.phone ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3"><Badge variant={statusVariant[flight.status]}>{statusLabel[flight.status]}</Badge></td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(flight.started_at).toLocaleString('tr-TR')}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{flight.location_points_count ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/flights/${flight.id}`}
                        className="text-xs text-blue-600 hover:underline">Detay</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}
