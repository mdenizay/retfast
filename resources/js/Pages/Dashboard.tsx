import React from 'react';
import { Head, Link } from '@inertiajs/react';
import { Layout } from '../Components/Layout';
import { Badge } from '../Components/Badge';
import { Calendar, Plane, Users, Activity } from 'lucide-react';
import { Event } from '../types';

interface Props {
  events: Event[];
  stats: {
    total_events?: number;
    active_events?: number;
    total_flights?: number;
    active_flights?: number;
  };
}

const statusLabel: Record<Event['status'], string> = {
  draft: 'Taslak', active: 'Aktif', completed: 'Tamamlandı', cancelled: 'İptal',
};
const statusVariant: Record<Event['status'], 'default' | 'success' | 'warning' | 'danger'> = {
  draft: 'default', active: 'success', completed: 'default', cancelled: 'danger',
};

export default function Dashboard({ events, stats }: Props) {
  return (
    <Layout>
      <Head title="Panel" />
      <div className="p-6">
        <h1 className="text-xl font-semibold text-gray-900 mb-6">Panel</h1>

        {/* Stats */}
        {Object.keys(stats).length > 0 && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mb-8">
            {[
              { label: 'Toplam Etkinlik', value: stats.total_events ?? 0, icon: Calendar, color: 'text-blue-600' },
              { label: 'Aktif Etkinlik', value: stats.active_events ?? 0, icon: Activity, color: 'text-green-600' },
              { label: 'Toplam Uçuş', value: stats.total_flights ?? 0, icon: Plane, color: 'text-purple-600' },
              { label: 'Aktif Uçuş', value: stats.active_flights ?? 0, icon: Users, color: 'text-orange-600' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="rounded-xl border border-gray-100 bg-white p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">{label}</p>
                  <Icon className={`h-4 w-4 ${color}`} />
                </div>
                <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Recent events */}
        <div className="rounded-xl border border-gray-100 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">Son Etkinlikler</h2>
            <Link href="/events" className="text-xs text-blue-600 hover:underline">Tümünü gör</Link>
          </div>
          {events.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-400">Etkinlik yok</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {events.map(event => (
                <div key={event.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <Link href={`/events/${event.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600">
                      {event.name}
                    </Link>
                    <p className="text-xs text-gray-400">{event.location}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={statusVariant[event.status]}>{statusLabel[event.status]}</Badge>
                    <Link
                      href={`/events/${event.id}/flights`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Uçuşlar
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
