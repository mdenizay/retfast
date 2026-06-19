import React from 'react';
import { usePage, Link } from '@inertiajs/react';
import { LayoutDashboard, Calendar, Users, Radio, LogOut } from 'lucide-react';
import { PageProps } from '../types';

const navItems = [
  { href: '/', label: 'Panel', icon: LayoutDashboard, roles: ['admin', 'event_manager'] as const },
  { href: '/events', label: 'Etkinlikler', icon: Calendar, roles: ['admin', 'event_manager'] as const },
  { href: '/users', label: 'Kullanıcılar', icon: Users, roles: ['admin'] as const },
];

export function Layout({ children, fullHeight = false }: { children: React.ReactNode; fullHeight?: boolean }) {
  const { auth, flash } = usePage<PageProps>().props;
  const user = auth.user!;

  const visible = navItems.filter(item => item.roles.includes(user.role as any));

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="flex h-full w-56 flex-col border-r border-gray-100 bg-white">
        <div className="flex h-14 items-center gap-2 border-b border-gray-100 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600">
            <Radio className="h-4 w-4 text-white" />
          </div>
          <span className="text-base font-bold tracking-tight text-gray-900">RETFAST</span>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {visible.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-gray-100 p-3">
          <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-700">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{user.name}</p>
              <p className="truncate text-xs text-gray-500 capitalize">{user.role}</p>
            </div>
            <Link
              href="/logout"
              method="post"
              as="button"
              className="text-gray-400 hover:text-gray-600"
              title="Çıkış Yap"
            >
              <LogOut className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Flash messages */}
        {flash?.success && (
          <div className="mx-6 mt-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-700 border border-green-200">
            {flash.success}
          </div>
        )}
        {flash?.error && (
          <div className="mx-6 mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
            {flash.error}
          </div>
        )}
        <main className={`flex-1 ${fullHeight ? 'overflow-hidden' : 'overflow-auto'}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
