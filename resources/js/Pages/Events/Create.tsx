import React from 'react';
import { Head, Link, useForm } from '@inertiajs/react';
import { Layout } from '../../Components/Layout';
import { Plus, Trash2 } from 'lucide-react';

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

export default function EventCreate() {
  const { data, setData, post, processing, errors } = useForm({
    name: '',
    description: '',
    location: '',
    start_date: '',
    end_date: '',
    map_center_lat: '',
    map_center_lng: '',
    map_zoom: '10',
    max_pilots: '',
    drop_off_points: [] as { name: string; lat: string; lng: string }[],
  });

  const addDropOff = () => {
    setData('drop_off_points', [...data.drop_off_points, { name: '', lat: '', lng: '' }]);
  };

  const removeDropOff = (i: number) => {
    setData('drop_off_points', data.drop_off_points.filter((_, idx) => idx !== i));
  };

  const updateDropOff = (i: number, field: string, val: string) => {
    const updated = [...data.drop_off_points];
    updated[i] = { ...updated[i], [field]: val };
    setData('drop_off_points', updated);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    post('/events');
  };

  return (
    <Layout>
      <Head title="Yeni Etkinlik" />
      <div className="p-6 max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/events" className="text-sm text-gray-500 hover:text-gray-700">← Etkinlikler</Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-xl font-semibold text-gray-900">Yeni Etkinlik</h1>
        </div>

        <form onSubmit={submit} className="space-y-6">
          <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Temel Bilgiler</h2>
            <Field label="Etkinlik Adı" error={errors.name}>
              <input type="text" value={data.name} onChange={e => setData('name', e.target.value)}
                className={inputCls} required />
            </Field>
            <Field label="Konum" error={errors.location}>
              <input type="text" value={data.location} onChange={e => setData('location', e.target.value)}
                className={inputCls} required />
            </Field>
            <Field label="Açıklama" error={errors.description}>
              <textarea value={data.description} onChange={e => setData('description', e.target.value)}
                className={inputCls} rows={3} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Başlangıç Tarihi" error={errors.start_date}>
                <input type="datetime-local" value={data.start_date} onChange={e => setData('start_date', e.target.value)}
                  className={inputCls} required />
              </Field>
              <Field label="Bitiş Tarihi" error={errors.end_date}>
                <input type="datetime-local" value={data.end_date} onChange={e => setData('end_date', e.target.value)}
                  className={inputCls} required />
              </Field>
            </div>
            <Field label="Maksimum Pilot Sayısı" error={errors.max_pilots}>
              <input type="number" value={data.max_pilots} onChange={e => setData('max_pilots', e.target.value)}
                className={inputCls} min="1" />
            </Field>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Harita Merkezi</h2>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Enlem">
                <input type="number" step="any" value={data.map_center_lat} onChange={e => setData('map_center_lat', e.target.value)}
                  className={inputCls} placeholder="38.4089" />
              </Field>
              <Field label="Boylam">
                <input type="number" step="any" value={data.map_center_lng} onChange={e => setData('map_center_lng', e.target.value)}
                  className={inputCls} placeholder="27.1414" />
              </Field>
              <Field label="Zoom">
                <input type="number" value={data.map_zoom} onChange={e => setData('map_zoom', e.target.value)}
                  className={inputCls} min="1" max="20" />
              </Field>
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Bırakma Noktaları</h2>
              <button type="button" onClick={addDropOff}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                <Plus className="h-3 w-3" /> Ekle
              </button>
            </div>
            {data.drop_off_points.map((pt, i) => (
              <div key={i} className="flex items-end gap-3 rounded-lg border border-gray-100 p-3">
                <div className="flex-1">
                  <input placeholder="Ad" value={pt.name} onChange={e => updateDropOff(i, 'name', e.target.value)}
                    className={inputCls} />
                </div>
                <div className="w-28">
                  <input placeholder="Enlem" type="number" step="any" value={pt.lat} onChange={e => updateDropOff(i, 'lat', e.target.value)}
                    className={inputCls} />
                </div>
                <div className="w-28">
                  <input placeholder="Boylam" type="number" step="any" value={pt.lng} onChange={e => updateDropOff(i, 'lng', e.target.value)}
                    className={inputCls} />
                </div>
                <button type="button" onClick={() => removeDropOff(i)} className="text-red-400 hover:text-red-600 mb-0.5">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={processing}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {processing ? 'Kaydediliyor...' : 'Etkinlik Oluştur'}
            </button>
            <Link href="/events" className="text-sm text-gray-500 hover:text-gray-700">İptal</Link>
          </div>
        </form>
      </div>
    </Layout>
  );
}
