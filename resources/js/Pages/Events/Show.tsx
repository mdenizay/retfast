import React, { useState } from 'react';
import { Head, Link, router } from '@inertiajs/react';
import { Layout } from '../../Components/Layout';
import { Badge } from '../../Components/Badge';
import { Event, EventApplication, User } from '../../types';
import { CheckCircle, XCircle, UserPlus } from 'lucide-react';

const statusLabel: Record<Event['status'], string> = {
  draft: 'Taslak', active: 'Aktif', completed: 'Tamamlandı', cancelled: 'İptal',
};
const statusVariant: Record<Event['status'], 'default' | 'success' | 'warning' | 'danger'> = {
  draft: 'default', active: 'success', completed: 'default', cancelled: 'danger',
};
const appStatusVariant = {
  pending: 'warning', approved: 'success', rejected: 'danger',
} as const;
const appStatusLabel = { pending: 'Bekliyor', approved: 'Onaylandı', rejected: 'Reddedildi' };

export default function EventShow({
  event,
  applications,
  available_managers,
}: {
  event: Event & { creator?: Pick<User, 'id' | 'name'>; managers: User[] };
  applications: EventApplication[];
  available_managers: User[];
}) {
  const [addingManager, setAddingManager] = useState(false);
  const [selectedManagerId, setSelectedManagerId] = useState('');

  const reviewApp = (applicationId: string, status: 'approved' | 'rejected') => {
    router.patch(`/events/${event.id}/applications/${applicationId}`, { status });
  };

  const addManager = () => {
    if (!selectedManagerId) return;
    router.post(`/events/${event.id}/managers`, { user_id: selectedManagerId }, {
      onSuccess: () => { setAddingManager(false); setSelectedManagerId(''); },
    });
  };

  const removeManager = (userId: string) => {
    if (confirm('Bu yöneticiyi kaldırmak istediğinizden emin misiniz?')) {
      router.delete(`/events/${event.id}/managers/${userId}`);
    }
  };

  const pending = applications.filter(a => a.status === 'pending');

  return (
    <Layout>
      <Head title={event.name} />
      <div className="p-6 space-y-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link href="/events" className="text-sm text-gray-500 hover:text-gray-700">← Etkinlikler</Link>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">{event.name}</h1>
            <p className="text-sm text-gray-500">{event.location}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant[event.status]}>{statusLabel[event.status]}</Badge>
            <Link href={`/events/${event.id}/edit`}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
              Düzenle
            </Link>
            <Link href={`/events/${event.id}/live`}
              className="rounded-md bg-green-50 border border-green-200 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100">
              Canlı İzle
            </Link>
            <Link href={`/events/${event.id}/flights`}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
              Uçuşlar
            </Link>
          </div>
        </div>

        {/* Managers */}
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Etkinlik Yöneticileri</h2>
            <button onClick={() => setAddingManager(v => !v)}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
              <UserPlus className="h-3 w-3" /> Yönetici Ekle
            </button>
          </div>
          {addingManager && (
            <div className="flex items-center gap-2 mb-3">
              <select value={selectedManagerId} onChange={e => setSelectedManagerId(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm flex-1 focus:outline-none">
                <option value="">Yönetici seçin</option>
                {available_managers.filter(m => !event.managers?.find(em => em.id === m.id)).map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.email})</option>
                ))}
              </select>
              <button onClick={addManager}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
                Ekle
              </button>
            </div>
          )}
          {event.managers?.length === 0 ? (
            <p className="text-sm text-gray-400">Henüz yönetici yok</p>
          ) : (
            <div className="space-y-2">
              {event.managers?.map(m => (
                <div key={m.id} className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{m.name}</p>
                    <p className="text-xs text-gray-500">{m.email}</p>
                  </div>
                  <button onClick={() => removeManager(m.id)}
                    className="text-xs text-red-500 hover:text-red-700">Kaldır</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending applications */}
        {pending.length > 0 && (
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-5">
            <h2 className="text-sm font-semibold text-amber-900 mb-3">Bekleyen Başvurular ({pending.length})</h2>
            <div className="space-y-2">
              {pending.map(app => (
                <div key={app.id} className="flex items-center justify-between rounded-md bg-white border border-amber-100 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{app.user?.name}</p>
                    <p className="text-xs text-gray-500">{app.type === 'pilot' ? 'Pilot' : 'Retriever'} — {app.notes || '—'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => reviewApp(app.id, 'approved')}
                      className="flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700">
                      <CheckCircle className="h-3 w-3" /> Onayla
                    </button>
                    <button onClick={() => reviewApp(app.id, 'rejected')}
                      className="flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700">
                      <XCircle className="h-3 w-3" /> Reddet
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All applications */}
        <div className="rounded-xl border border-gray-100 bg-white">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">Tüm Başvurular ({applications.length})</h2>
          </div>
          {applications.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-400">Başvuru yok</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-50">
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Kullanıcı</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Tür</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Durum</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Not</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {applications.map(app => (
                  <tr key={app.id}>
                    <td className="px-5 py-3 font-medium text-gray-900">
                      {app.user?.name}
                      <br />
                      <span className="text-xs text-gray-400">{app.user?.email}</span>
                    </td>
                    <td className="px-4 py-3"><Badge>{app.type === 'pilot' ? 'Pilot' : 'Retriever'}</Badge></td>
                    <td className="px-4 py-3"><Badge variant={appStatusVariant[app.status]}>{appStatusLabel[app.status]}</Badge></td>
                    <td className="px-4 py-3 text-xs text-gray-500">{app.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Drop-off points */}
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Bırakma Noktaları</h2>
          {event.drop_off_points.length === 0 ? (
            <p className="text-sm text-gray-400">Bırakma noktası yok</p>
          ) : (
            <div className="space-y-2">
              {event.drop_off_points.map(pt => (
                <div key={pt.id} className="flex items-center gap-3 rounded-md bg-gray-50 px-3 py-2">
                  {pt.is_default && <Badge variant="info">Varsayılan</Badge>}
                  <span className="text-sm font-medium text-gray-900">{pt.name}</span>
                  <span className="text-xs text-gray-400">{pt.lat}, {pt.lng}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
