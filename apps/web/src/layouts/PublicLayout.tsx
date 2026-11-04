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
    cn("text-footnote font-medium hover:text-fg", isActive ? "text-fg" : "text-fg-secondary");
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2">
        {t("a11y.skip")}
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-none">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" aria-label="Retfast"><Logo /></Link>
          <nav className="hidden items-center gap-5 sm:flex" aria-label={t("nav.main")}>
            <NavLink to="/events" className={nav}>{t("nav.events")}</NavLink>
            <NavLink to="/privacy" className={nav}>{t("nav.privacy")}</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle className="hidden sm:inline-flex" />
            <LangToggle />
            {status === "authenticated" ? (
              <Button asChild size="sm"><Link to="/app">{t("nav.openApp")}</Link></Button>
            ) : (
              <Button asChild size="sm" variant="outline"><Link to="/login">{t("auth.login")}</Link></Button>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-caption text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>© {new Date().getFullYear()} Retfast · {t("footer.tagline")}</span>
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
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-start justify-center px-4 py-12 sm:py-20">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
