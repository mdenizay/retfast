import React from 'react';
import { useForm, Head, Link } from '@inertiajs/react';

export default function Register() {
  const { data, setData, post, processing, errors } = useForm({
    name: '',
    email: '',
    password: '',
    password_confirmation: '',
    phone: '',
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    post('/register');
  };

  return (
    <>
      <Head title="Kayıt" />
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900">Hesap Oluştur</h1>
            <p className="mt-1 text-sm text-gray-500">Retfast'a katılın</p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <form onSubmit={submit} className="space-y-4">
              {[
                { field: 'name' as const, label: 'Ad Soyad', type: 'text' },
                { field: 'email' as const, label: 'E-posta', type: 'email' },
                { field: 'phone' as const, label: 'Telefon (opsiyonel)', type: 'tel' },
                { field: 'password' as const, label: 'Şifre', type: 'password' },
                { field: 'password_confirmation' as const, label: 'Şifre Tekrar', type: 'password' },
              ].map(({ field, label, type }) => (
                <div key={field}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input
                    type={type}
                    value={data[field]}
                    onChange={e => setData(field, e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  {errors[field] && <p className="mt-1 text-xs text-red-600">{errors[field]}</p>}
                </div>
              ))}

              <button
                type="submit"
                disabled={processing}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {processing ? 'Kaydediliyor...' : 'Kayıt Ol'}
              </button>

              <p className="text-center text-xs text-gray-500">
                Hesabın var mı?{' '}
                <Link href="/login" className="text-blue-600 hover:underline">Giriş yap</Link>
              </p>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
