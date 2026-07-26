import { Moon, Sun } from "lucide-react";

import { useLocale } from "../i18n";
import { useTheme } from "../contexts/PreferencesContext";

export function PreferencesBar() {
  const { locale, setLocale } = useLocale();
  const { theme, setTheme } = useTheme();

  return (
    <div className="preferences-bar">
      <div className="segmented-control" aria-label="Language">
        <button
          type="button"
          className={locale === "tr" ? "active" : ""}
          onClick={() => setLocale("tr")}
          aria-pressed={locale === "tr"}
        >
          TR
        </button>
        <button
          type="button"
          className={locale === "en" ? "active" : ""}
          onClick={() => setLocale("en")}
          aria-pressed={locale === "en"}
        >
          EN
        </button>
      </div>
      <button
        type="button"
        className="icon-button"
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        aria-label={theme === "light" ? "Dark mode" : "Light mode"}
      >
        {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
      </button>
    </div>
  );
}
