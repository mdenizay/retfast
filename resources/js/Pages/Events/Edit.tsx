import React from 'react';
import { Head, Link, useForm } from '@inertiajs/react';
import { Layout } from '../../Components/Layout';
import { Event } from '../../types';

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none';

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
      {error && <p className="mt-0.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function EventEdit({ event }: { event: Event }) {
  const { data, setData, patch, processing, errors } = useForm({
    name: event.name,
    description: event.description ?? '',
    location: event.location,
    status: event.status,
    start_date: event.start_date.slice(0, 16),
    end_date: event.end_date.slice(0, 16),
    map_center_lat: event.map_center_lat?.toString() ?? '',
    map_center_lng: event.map_center_lng?.toString() ?? '',
    map_zoom: event.map_zoom?.toString() ?? '10',
    max_pilots: event.max_pilots?.toString() ?? '',
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    patch(`/events/${event.id}`);
  };

  return (
    <Layout>
      <Head title={`Düzenle: ${event.name}`} />
      <div className="p-6 max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <Link href={`/events/${event.id}`} className="text-sm text-gray-500 hover:text-gray-700">← Etkinlik</Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-xl font-semibold text-gray-900">Düzenle</h1>
        </div>

        <form onSubmit={submit} className="space-y-6">
          <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Temel Bilgiler</h2>
            <Field label="Etkinlik Adı" error={errors.name}>
              <input type="text" value={data.name} onChange={e => setData('name', e.target.value)} className={inputCls} required />
            </Field>
            <Field label="Konum" error={errors.location}>
              <input type="text" value={data.location} onChange={e => setData('location', e.target.value)} className={inputCls} required />
            </Field>
            <Field label="Açıklama">
              <textarea value={data.description} onChange={e => setData('description', e.target.value)} className={inputCls} rows={3} />
            </Field>
            <Field label="Durum" error={errors.status}>
              <select value={data.status} onChange={e => setData('status', e.target.value as Event['status'])} className={inputCls}>
                <option value="draft">Taslak</option>
                <option value="active">Aktif</option>
                <option value="completed">Tamamlandı</option>
                <option value="cancelled">İptal</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Başlangıç Tarihi" error={errors.start_date}>
                <input type="datetime-local" value={data.start_date} onChange={e => setData('start_date', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Bitiş Tarihi" error={errors.end_date}>
                <input type="datetime-local" value={data.end_date} onChange={e => setData('end_date', e.target.value)} className={inputCls} />
              </Field>
            </div>
            <Field label="Maksimum Pilot Sayısı">
              <input type="number" value={data.max_pilots} onChange={e => setData('max_pilots', e.target.value)} className={inputCls} min="1" />
            </Field>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Harita Merkezi</h2>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Enlem">
                <input type="number" step="any" value={data.map_center_lat} onChange={e => setData('map_center_lat', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Boylam">
                <input type="number" step="any" value={data.map_center_lng} onChange={e => setData('map_center_lng', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Zoom">
                <input type="number" value={data.map_zoom} onChange={e => setData('map_zoom', e.target.value)} className={inputCls} min="1" max="20" />
              </Field>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={processing}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {processing ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
            <Link href={`/events/${event.id}`} className="text-sm text-gray-500 hover:text-gray-700">İptal</Link>
          </div>
        </form>
      </div>
    </Layout>
  );
}
