import React from 'react';
import { Head, Link, router } from '@inertiajs/react';
import { Layout } from '../../Components/Layout';
import { Badge } from '../../Components/Badge';
import { Plus, Calendar, MapPin, Users, Plane } from 'lucide-react';
import { Event } from '../../types';

const statusLabel: Record<Event['status'], string> = {
  draft: 'Taslak', active: 'Aktif', completed: 'Tamamlandı', cancelled: 'İptal',
};
const statusVariant: Record<Event['status'], 'default' | 'success' | 'warning' | 'danger'> = {
  draft: 'default', active: 'success', completed: 'default', cancelled: 'danger',
};

export default function EventsIndex({ events }: { events: Event[] }) {
  return (
    <Layout>
      <Head title="Etkinlikler" />
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Etkinlikler</h1>
          <Link
            href="/events/create"
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Yeni Etkinlik
          </Link>
        </div>

        {events.length === 0 ? (
          <div className="rounded-xl border border-gray-100 bg-white px-6 py-12 text-center">
            <Calendar className="mx-auto mb-3 h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-500">Henüz etkinlik yok</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {events.map(event => (
              <div key={event.id} className="rounded-xl border border-gray-100 bg-white p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Link href={`/events/${event.id}`} className="text-base font-semibold text-gray-900 hover:text-blue-600">
                        {event.name}
                      </Link>
                      <Badge variant={statusVariant[event.status]}>{statusLabel[event.status]}</Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {event.location}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(event.start_date).toLocaleDateString('tr-TR')}
                      </span>
                      {event.pending_count ? (
                        <span className="flex items-center gap-1 text-amber-600">
                          <Users className="h-3 w-3" />
                          {event.pending_count} bekleyen başvuru
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <Link
                      href={`/events/${event.id}/flights`}
                      className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <Plane className="h-3 w-3" />
                      Uçuşlar
                    </Link>
                    <Link
                      href={`/events/${event.id}/live`}
                      className="flex items-center gap-1 rounded-md bg-green-50 border border-green-200 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
                    >
                      Canlı
                    </Link>
                    <Link
                      href={`/events/${event.id}/edit`}
                      className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Düzenle
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
