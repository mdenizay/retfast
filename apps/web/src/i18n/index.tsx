import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { en, type Messages } from "./en";
import { tr } from "./tr";

export const LOCALES = ["en", "tr"] as const;
export type Locale = (typeof LOCALES)[number];

const catalogs: Record<Locale, Messages> = { en, tr };

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  messages: Messages;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  setLocale: () => {},
  messages: en,
});

function detectLocale(): Locale {
  const stored = localStorage.getItem("retfast.locale");
  if (stored === "en" || stored === "tr") return stored;
  return navigator.language.startsWith("tr") ? "tr" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);
  const setLocale = useCallback((l: Locale) => {
    localStorage.setItem("retfast.locale", l);
    setLocaleState(l);
  }, []);
  const value = useMemo(
    () => ({ locale, setLocale, messages: catalogs[locale] }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** `const { m, locale } = useI18n()` → `m.events.title` (typed, no string keys). */
export function useI18n() {
  const { locale, setLocale, messages } = useContext(I18nContext);
  return { locale, setLocale, m: messages };
}
