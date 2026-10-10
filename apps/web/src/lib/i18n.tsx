"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { errorMessage, translate, type Locale, type MessageKey } from "@retfast/core";

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  err: (code: string) => string;
};

const I18n = createContext<Ctx | null>(null);

export function I18nProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial);
  const setLocale = useCallback((l: Locale) => {
    document.cookie = `rf_locale=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    setLocaleState(l);
  }, []);
  const t = useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);
  const err = useCallback((code: string) => errorMessage(locale, code), [locale]);
  return <I18n.Provider value={{ locale, setLocale, t, err }}>{children}</I18n.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18n);
  if (!ctx) throw new Error("useI18n outside provider");
  return ctx;
}

export function formatDate(locale: Locale, iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", opts).format(new Date(iso));
}

export function formatRange(locale: Locale, a: string, b: string) {
  const f = (s: string) => formatDate(locale, s, { day: "numeric", month: "short" });
  return `${f(a)} – ${formatDate(locale, b)}`;
}
