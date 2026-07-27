import * as SecureStore from "expo-secure-store";
import { getLocales } from "expo-localization";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useColorScheme } from "react-native";

import { messages, type Copy, type Locale } from "../i18n";
import { darkPalette, lightPalette, type Palette } from "../theme";

type Theme = "light" | "dark";

type PreferencesValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  copy: Copy;
  palette: Palette;
};

const PreferencesContext = createContext<PreferencesValue | null>(null);

const LOCALE_KEY = "retfast.locale";
const THEME_KEY = "retfast.theme";

export function PreferencesProvider({ children }: PropsWithChildren) {
  const systemTheme = useColorScheme();
  const deviceLocale: Locale = getLocales()[0]?.languageCode === "tr" ? "tr" : "en";
  const [locale, setLocaleState] = useState<Locale>(deviceLocale);
  const [theme, setThemeState] = useState<Theme>(systemTheme === "dark" ? "dark" : "light");

  useEffect(() => {
    void Promise.all([
      SecureStore.getItemAsync(LOCALE_KEY),
      SecureStore.getItemAsync(THEME_KEY),
    ]).then(([storedLocale, storedTheme]) => {
      if (storedLocale === "tr" || storedLocale === "en") {
        setLocaleState(storedLocale);
      }
      if (storedTheme === "light" || storedTheme === "dark") {
        setThemeState(storedTheme);
      }
    });
  }, []);

  const value = useMemo<PreferencesValue>(
    () => ({
      locale,
      setLocale: (nextLocale) => {
        setLocaleState(nextLocale);
        void SecureStore.setItemAsync(LOCALE_KEY, nextLocale);
      },
      theme,
      setTheme: (nextTheme) => {
        setThemeState(nextTheme);
        void SecureStore.setItemAsync(THEME_KEY, nextTheme);
      },
      copy: messages[locale],
      palette: theme === "dark" ? darkPalette : lightPalette,
    }),
    [locale, theme],
  );

  return <PreferencesContext value={value}>{children}</PreferencesContext>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used inside PreferencesProvider");
  }
  return context;
}
