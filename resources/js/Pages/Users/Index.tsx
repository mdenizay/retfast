import React, { useState } from 'react';
import { Head, router } from '@inertiajs/react';
import { Layout } from '../../Components/Layout';
import { Badge } from '../../Components/Badge';
import { User } from '../../types';
import { Search } from 'lucide-react';

type RoleFilter = 'all' | User['role'];

const roleLabel: Record<User['role'], string> = {
  admin: 'Admin', event_manager: 'Yönetici', pilot: 'Pilot', retriever: 'Retriever',
};
const roleVariant: Record<User['role'], 'default' | 'info' | 'success' | 'warning'> = {
  admin: 'default', event_manager: 'info', pilot: 'success', retriever: 'warning',
};

export default function UsersIndex({ users }: { users: User[] }) {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = users.filter(u => {
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    const matchSearch = !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    return matchRole && matchSearch;
  });

  const updateUser = (id: string, data: Partial<User>) => {
    router.patch(`/users/${id}`, data, { onSuccess: () => setEditingId(null) });
  };

  return (
    <Layout>
      <Head title="Kullanıcılar" />
      <div className="flex h-full flex-col">
        <div className="border-b border-gray-100 bg-white px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-semibold text-gray-900">Kullanıcılar</h1>
            <span className="text-sm text-gray-400">{users.length} kayıt</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="İsim veya e-posta..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full rounded-md border border-gray-200 py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div className="flex items-center gap-0.5 rounded-md border border-gray-200 p-0.5">
              {(['all', 'admin', 'event_manager', 'pilot', 'retriever'] as RoleFilter[]).map(r => (
                <button key={r} onClick={() => setRoleFilter(r)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${roleFilter === r ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-900'}`}>
                  {r === 'all' ? 'Tümü' : roleLabel[r as User['role']]}
                  {' '}({r === 'all' ? users.length : users.filter(u => u.role === r).length})
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50">
              <tr className="border-b border-gray-100">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">Kullanıcı</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Rol</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Durum</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Telefon</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 bg-white">
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-700">
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{u.name}</p>
                        <p className="text-xs text-gray-400">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {editingId === u.id ? (
                      <select defaultValue={u.role}
                        onChange={e => updateUser(u.id, { role: e.target.value as User['role'] })}
                        className="rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none">
                        <option value="admin">Admin</option>
                        <option value="event_manager">Yönetici</option>
                        <option value="pilot">Pilot</option>
                        <option value="retriever">Retriever</option>
                      </select>
                    ) : (
                      <Badge variant={roleVariant[u.role]}>{roleLabel[u.role]}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={u.is_active ? 'success' : 'default'}>
                      {u.is_active ? 'Aktif' : 'Pasif'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{u.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {editingId === u.id ? (
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-700">İptal</button>
                      ) : (
                        <button onClick={() => setEditingId(u.id)} className="text-xs text-blue-600 hover:text-blue-700">Rolü Değiştir</button>
                      )}
                      <button
                        onClick={() => updateUser(u.id, { is_active: !u.is_active })}
                        className={`text-xs font-medium ${u.is_active ? 'text-red-500 hover:text-red-700' : 'text-green-600 hover:text-green-700'}`}>
                        {u.is_active ? 'Pasifleştir' : 'Aktifleştir'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
