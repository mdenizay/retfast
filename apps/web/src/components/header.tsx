"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Button } from "./ui";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <svg viewBox="0 0 1024 1024" className="h-7 w-7 rounded-md" aria-hidden>
        <rect width="1024" height="1024" fill="#000" />
        <path fill="#F3A712" d="M512 164 790 850 512 704 234 850 512 164Zm0 176-125 310 125-66 125 66-125-310Z" />
      </svg>
      <span className="text-lg font-black tracking-tight">RETFAST</span>
    </Link>
  );
}

export function LocaleSwitch() {
  const { locale, setLocale } = useI18n();
  const { user } = useSession();
  return (
    <button
      className="h-8 rounded-full px-3 text-xs font-medium text-muted hover:bg-white/[0.06] hover:text-ivory"
      onClick={() => {
        const next = locale === "tr" ? "en" : "tr";
        setLocale(next);
        if (user) void import("@/lib/api").then(({ api }) => api.me.update({ locale: next }));
      }}
    >
      {locale === "tr" ? "EN" : "TR"}
    </button>
  );
}

export function Header() {
  const { t } = useI18n();
  const { user, loading, logout } = useSession();
  return (
    <header className="sticky top-0 z-30 px-4 pt-3">
      <div className="glass mx-auto flex h-14 max-w-6xl items-center gap-4 rounded-full pl-5 pr-2.5">
        <Logo />
        <nav className="ml-4 hidden items-center gap-1 text-sm sm:flex">
          <Link className="rounded-full px-4 py-1.5 text-muted hover:bg-white/[0.06] hover:text-ivory" href="/#events">{t("nav.events")}</Link>
          {user && <Link className="rounded-full px-4 py-1.5 text-muted hover:bg-white/[0.06] hover:text-ivory" href="/app">{t("nav.dashboard")}</Link>}
          {user?.is_system_admin && <Link className="rounded-full px-4 py-1.5 text-muted hover:bg-white/[0.06] hover:text-ivory" href="/app/admin">{t("nav.admin")}</Link>}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitch />
          {loading ? null : user ? (
            <>
              <Link href="/app/profile" className="hidden text-sm text-muted hover:text-ivory sm:block">{user.first_name}</Link>
              <Button size="sm" variant="ghost" onClick={logout}>{t("nav.logout")}</Button>
            </>
          ) : (
            <>
              <Link href="/login"><Button size="sm" variant="ghost">{t("nav.login")}</Button></Link>
              <Link href="/register"><Button size="sm" variant="primary">{t("nav.register")}</Button></Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
