import type { Locale, User } from '@retfast/core';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Tracking } from '../../modules/retfast-tracking';
import { api, isUnauthorized, loadToken, saveToken } from './api';
import { I18nProvider, deviceLocale } from './i18n';

type Ctx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (b: { email: string; password: string; first_name: string; last_name: string }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
};

const Session = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        if (await loadToken()) setUser(await api.me.get());
      } catch (e) {
        // Ağ hatasında oturum silinmez; yalnızca sunucu 401 derse çıkış yapılır.
        if (isUnauthorized(e)) await saveToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.auth.login({ email, password, platform: 'ios' });
    await saveToken(r.token);
    setUser(r.user);
  }, []);

  const register = useCallback(async (b: { email: string; password: string; first_name: string; last_name: string }) => {
    const r = await api.auth.register({ ...b, locale: deviceLocale(), platform: 'ios' });
    await saveToken(r.token);
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    await Tracking.reset().catch(() => undefined);
    await api.auth.logout().catch(() => undefined);
    await saveToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, register, logout, setUser }), [user, loading, login, register, logout]);
  const locale: Locale = user?.locale ?? deviceLocale();
  return (
    <Session.Provider value={value}>
      <I18nProvider locale={locale}>{children}</I18nProvider>
    </Session.Provider>
  );
}

export function useSession(): Ctx {
  const c = useContext(Session);
  if (!c) throw new Error('useSession outside provider');
  return c;
}
