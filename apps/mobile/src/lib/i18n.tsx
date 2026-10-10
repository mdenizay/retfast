import { errorMessage, translate, type Locale, type MessageKey } from '@retfast/core';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

type Ctx = {
  locale: Locale;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  err: (code: string) => string;
  date: (iso: string | number, opts?: Intl.DateTimeFormatOptions) => string;
};

const I18n = createContext<Ctx | null>(null);

export function deviceLocale(): Locale {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('tr') ? 'tr' : 'en';
  } catch {
    return 'en';
  }
}

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<Ctx>(
    () => ({
      locale,
      t: (key, vars) => translate(locale, key, vars),
      err: (code) => errorMessage(locale, code),
      date: (iso, opts = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', opts).format(new Date(iso)),
    }),
    [locale],
  );
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18n);
  if (!c) throw new Error('useI18n outside provider');
  return c;
}
