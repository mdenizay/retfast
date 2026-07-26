import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import { getMessages, LocaleContext, type Locale } from "../i18n";

export type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
} | null>(null);

const THEME_KEY = "retfast.theme";
const LOCALE_KEY = "retfast.locale";

function getInitialTheme(): Theme {
  const storedTheme = localStorage.getItem(THEME_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getInitialLocale(): Locale {
  const storedLocale = localStorage.getItem(LOCALE_KEY);
  if (storedLocale === "tr" || storedLocale === "en") {
    return storedLocale;
  }

  return navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export function PreferencesProvider({ children }: PropsWithChildren) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [locale, setLocale] = useState<Locale>(getInitialLocale);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem(LOCALE_KEY, locale);
  }, [locale]);

  const localeValue = useMemo(
    () => ({ locale, setLocale, copy: getMessages(locale) }),
    [locale],
  );

  return (
    <LocaleContext value={localeValue}>
      <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>
    </LocaleContext>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside PreferencesProvider");
  }

  return context;
}
