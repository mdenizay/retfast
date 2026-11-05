import { Link, NavLink, Outlet } from "react-router";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/auth";
import { Logo } from "@/components/common";
import { Button } from "@/components/ui/button";
import { LangToggle, ThemeToggle } from "./Preferences";
import { cn } from "@/lib/utils";

export function PublicLayout() {
  const { t } = useI18n();
  const { status } = useSession();
  const nav = ({ isActive }: { isActive: boolean }) =>
    cn("rounded-full px-4 py-2 text-footnote font-medium transition-colors hover:text-fg", isActive ? "bg-surface text-fg" : "text-fg-muted");
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2">
        {t("a11y.skip")}
      </a>
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" aria-label="Retfast"><Logo /></Link>
          <nav className="hidden items-center gap-1 sm:flex" aria-label={t("nav.main")}>
            <NavLink to="/events" className={nav}>{t("nav.events")}</NavLink>
            <NavLink to="/privacy" className={nav}>{t("nav.privacy")}</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle className="hidden sm:inline-flex" />
            <LangToggle />
            {status === "authenticated" ? (
              <Button asChild size="sm"><Link to="/app">{t("nav.openApp")}</Link></Button>
            ) : (
              <Button asChild size="sm"><Link to="/login">{t("auth.login")}</Link></Button>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <footer>
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-caption text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>© {new Date().getFullYear()} Retfast · {t("landing.footerTagline")}</span>
          <nav className="flex gap-4" aria-label={t("nav.footer")}>
            <Link to="/events" className="hover:text-fg">{t("nav.events")}</Link>
            <Link to="/privacy" className="hover:text-fg">{t("nav.privacy")}</Link>
            <Link to="/login" className="hover:text-fg">{t("auth.login")}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-md flex-col justify-center px-4 py-10 sm:py-16">
      <div className="mb-8 flex flex-col items-center text-center" aria-hidden>
        <span className="grid size-16 place-items-center rounded-full bg-primary text-on-primary">
          <svg viewBox="0 0 32 32" className="size-8">
            <path fillRule="evenodd" d="M16 5.1 24.7 26.6 16 22 7.3 26.6Zm0 5.5-3.9 9.7 3.9-2.05 3.9 2.05Z" fill="currentColor" />
          </svg>
        </span>
        <p className="mt-4 max-w-xs text-footnote text-fg-muted">{t("landing.footerTagline")}</p>
      </div>
      <div className="rounded-3xl bg-surface p-6 sm:p-8">{children}</div>
    </div>
  );
}
