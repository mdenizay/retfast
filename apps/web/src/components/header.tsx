"use client";
import { Languages, Laptop, LogOut, Moon, Sun, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger, cx,
} from "./ui";

export function Logo() {
  return (
    <Link href="/" className="press flex items-center gap-2.5">
      <svg viewBox="0 0 1024 1024" className="h-8 w-8 rounded-[9px]" aria-hidden>
        <rect width="1024" height="1024" fill="#000" />
        <path fill="#fff" d="M512 164 790 850 512 704 234 850 512 164Zm0 176-125 310 125-66 125 66-125-310Z" />
      </svg>
      <span className="text-[17px] font-bold tracking-[-0.03em]">Retfast</span>
    </Link>
  );
}

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
const ICON = { system: Laptop, light: Sun, dark: Moon } as const;

/** Girişsiz ziyaretçi için hızlı görünüm düğmesi. */
export function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  const { t } = useI18n();
  const Icon = ICON[choice];
  return (
    <button onClick={() => setChoice(NEXT[choice])} aria-label={t(`theme.${choice}`)} title={t(`theme.${choice}`)}
      className="press flex h-9 w-9 items-center justify-center rounded-full text-label-2 outline-none hover:bg-fill-2 hover:text-label focus-visible:ring-2 focus-visible:ring-ring/60">
      <Icon size={18} strokeWidth={1.8} />
    </button>
  );
}

export function LocaleSwitch() {
  const { locale, setLocale } = useI18n();
  const { user } = useSession();
  return (
    <button
      className="press flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-label-2 outline-none hover:bg-fill-2 hover:text-label focus-visible:ring-2 focus-visible:ring-ring/60"
      onClick={() => {
        const next = locale === "tr" ? "en" : "tr";
        setLocale(next);
        if (user) void import("@/lib/api").then(({ api }) => api.me.update({ locale: next }));
      }}
    >
      <Languages size={16} strokeWidth={1.8} />
      {locale === "tr" ? "EN" : "TR"}
    </button>
  );
}

function NavLink({ href, children, match }: { href: string; children: React.ReactNode; match: (p: string) => boolean }) {
  const path = usePathname();
  return (
    <Link href={href} className={cx("press rounded-full px-4 py-1.5 text-[14px] font-medium", match(path) ? "bg-fill-2 text-label" : "text-label-2 hover:text-label")}>
      {children}
    </Link>
  );
}

function UserMenu() {
  const { t } = useI18n();
  const { user, logout } = useSession();
  const { choice, setChoice } = useTheme();
  const router = useRouter();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="press ml-1 flex h-9 items-center gap-2 rounded-full bg-fill pl-1 pr-3 text-[13px] font-medium outline-none hover:bg-fill-2 focus-visible:ring-2 focus-visible:ring-ring/60">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-tint-fill text-[12px] font-bold text-tint-ink">
            {(user.first_name[0] ?? "") + (user.last_name[0] ?? "")}
          </span>
          <span className="hidden sm:inline">{user.first_name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="px-2.5 py-2">
          <span className="block text-[14px] font-semibold text-foreground">{user.first_name} {user.last_name}</span>
          <span className="t-foot block font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/app/profile")}><UserRound />{t("nav.profile")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="t-section px-2.5 py-1.5">{t("theme.title")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={choice} onValueChange={(v) => setChoice(v as ThemeChoice)}>
          {(["system", "light", "dark"] as const).map((c) => {
            const Icon = ICON[c];
            return <DropdownMenuRadioItem key={c} value={c}><Icon />{t(`theme.opt_${c}`)}</DropdownMenuRadioItem>;
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void logout()}><LogOut />{t("nav.logout")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Header() {
  const { t } = useI18n();
  const { user, loading } = useSession();
  return (
    <header className="sticky top-0 z-30 px-4 pt-3">
      <div className="glass mx-auto flex h-14 max-w-6xl items-center gap-3 rounded-full pl-4 pr-2">
        <Logo />
        <nav className="ml-3 hidden items-center gap-0.5 sm:flex">
          <NavLink href="/#events" match={(p) => p === "/"}>{t("nav.events")}</NavLink>
          {user && <NavLink href="/app" match={(p) => p === "/app" || p.startsWith("/app/events")}>{t("nav.dashboard")}</NavLink>}
          {user?.is_system_admin && <NavLink href="/app/admin" match={(p) => p.startsWith("/app/admin")}>{t("nav.admin")}</NavLink>}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <LocaleSwitch />
          {loading ? null : user ? (
            <UserMenu />
          ) : (
            <>
              <ThemeToggle />
              <Link href="/login"><Button size="sm" variant="ghost">{t("nav.login")}</Button></Link>
              <Link href="/register"><Button size="sm" variant="primary">{t("nav.register")}</Button></Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
