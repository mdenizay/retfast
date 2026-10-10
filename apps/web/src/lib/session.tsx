"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@retfast/core";
import { api } from "./api";
import { useI18n } from "./i18n";

type Ctx = {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const Session = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { locale, setLocale } = useI18n();

  const setUser = useCallback(
    (u: User | null) => {
      setUserState(u);
      if (u && u.locale !== locale) setLocale(u.locale);
    },
    [locale, setLocale],
  );

  const refresh = useCallback(async () => {
    try {
      setUserState(await api.me.get());
    } catch {
      setUserState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    setUserState(null);
    window.location.href = "/";
  }, []);

  return <Session.Provider value={{ user, loading, setUser, refresh, logout }}>{children}</Session.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(Session);
  if (!ctx) throw new Error("useSession outside provider");
  return ctx;
}
