import { Languages, Monitor, Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useTheme, type ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { pref, setPref } = useTheme();
  const { t } = useI18n();
  const opts: { v: ThemePref; Icon: typeof Sun; label: string }[] = [
    { v: "system", Icon: Monitor, label: t("theme.system") },
    { v: "light", Icon: Sun, label: t("theme.light") },
    { v: "dark", Icon: Moon, label: t("theme.dark") },
  ];
  return (
    <div role="radiogroup" aria-label={t("theme.label")} className={cn("inline-flex rounded-full bg-muted p-1", className)}>
      {opts.map(({ v, Icon, label }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={pref === v}
          aria-label={label}
          title={label}
          onClick={() => setPref(v)}
          className={cn("grid size-8 place-items-center rounded-full text-fg-muted transition-colors hover:text-fg", pref === v && "bg-surface text-fg dark:bg-fg/12")}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}

export function LangToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "tr" ? "en" : "tr")}
      className={cn("inline-flex h-10 items-center gap-1.5 rounded-full bg-muted px-3.5 text-caption font-semibold text-fg-secondary transition-colors hover:text-fg", className)}
      aria-label={t("lang.switch")}
    >
      <Languages className="size-4" aria-hidden />
      {lang === "tr" ? "EN" : "TR"}
    </button>
  );
}
