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
    cn("rounded-md px-2.5 py-1.5 text-footnote font-medium transition-colors hover:bg-muted hover:text-fg", isActive ? "bg-muted text-fg" : "text-fg-secondary");
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2">
        {t("a11y.skip")}
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
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
    <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_minmax(0,24rem)] lg:items-center lg:gap-16 lg:py-16">
      <aside className="relative hidden min-h-[30rem] overflow-hidden rounded-2xl border border-border bg-surface p-10 shadow-xs lg:flex lg:flex-col lg:justify-end" aria-hidden>
        <div className="pointer-events-none absolute -top-32 -right-32 size-[30rem] rounded-full bg-[radial-gradient(closest-side,rgb(56_189_248/0.22),rgb(34_211_238/0.06)_60%,transparent)] blur-2xl" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgb(9_9_11/0.06)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_bottom,black,transparent_70%)] dark:bg-[radial-gradient(rgb(255_255_255/0.06)_1px,transparent_1px)]" />
        <svg viewBox="0 0 32 32" className="pointer-events-none absolute top-10 right-10 size-28">
          <defs>
            <linearGradient id="rf-auth-sunset" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#22D3EE" />
              <stop offset="0.55" stopColor="#0EA5E9" />
              <stop offset="1" stopColor="#0369A1" />
            </linearGradient>
          </defs>
          <path fillRule="evenodd" d="M16 5.1 24.7 26.6 16 22 7.3 26.6Zm0 5.5-3.9 9.7 3.9-2.05 3.9 2.05Z" fill="url(#rf-auth-sunset)" />
        </svg>
        <div className="relative max-w-md">
          <p className="text-caption font-semibold tracking-wide text-brand uppercase">{t("landing.eyebrow")}</p>
          <p className="mt-3 text-title1 font-semibold tracking-tight text-balance text-fg">{t("landing.title")}</p>
          <p className="mt-3 text-body text-fg-muted text-pretty">{t("landing.footerTagline")}</p>
        </div>
      </aside>
      <div className="w-full max-w-sm justify-self-center lg:justify-self-stretch">{children}</div>
    </div>
  );
}
