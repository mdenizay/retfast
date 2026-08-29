import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/auth/AuthProvider";
import { useI18n, LOCALES } from "@/i18n";
import { supabase } from "@/lib/supabase";
import {
  CalendarDays,
  CircleUser,
  Globe,
  LogOut,
  Navigation,
  Search,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";

export default function Layout() {
  const { profile } = useAuth();
  const { m, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const navCls = ({ isActive }: { isActive: boolean }) =>
    `app-rail-link ${isActive ? "is-active" : ""}`;

  async function logout() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  return (
    <div className="app-shell">
      <aside className="app-rail">
        <Link to="/events" className="app-rail-brand" aria-label="RETFAST">
          <Navigation className="size-5 fill-current" />
        </Link>
        <nav className="app-rail-nav" aria-label="Primary">
          <NavLink to="/events" className={navCls} title={m.nav.events}>
            <CalendarDays /><span>{m.nav.events}</span>
          </NavLink>
          {profile?.is_system_admin && (
            <NavLink to="/users" className={navCls} title={m.nav.users}>
              <Users /><span>{m.nav.users}</span>
            </NavLink>
          )}
          <NavLink to="/profile" className={navCls} title={m.nav.profile}>
            <UserRound /><span>{m.nav.profile}</span>
          </NavLink>
        </nav>
        <div className="mt-auto flex flex-col gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="app-rail-link" title={m.common.language}>
                <Globe /><span>{locale.toUpperCase()}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end">
              {LOCALES.map((l) => (
                <DropdownMenuItem key={l} onClick={() => setLocale(l)}>
                  {l === "en" ? "English" : "Türkçe"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button className="app-rail-link" onClick={logout} title={m.common.logout}>
            <LogOut /><span>{m.common.logout}</span>
          </button>
        </div>
      </aside>

      <section className="app-workspace">
        <header className="command-bar">
          <Link to="/events" className="min-w-0">
            <div className="brand-kicker">FLIGHT OPERATIONS</div>
            <div className="brand-wordmark text-lg leading-none">RETFAST</div>
          </Link>
          <div className="command-search" aria-hidden="true">
            <Search className="size-4" />
            <span>{locale === "tr" ? "Etkinlik, pilot veya görev ara" : "Search events, pilots or tasks"}</span>
            <kbd>⌘ K</kbd>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/7 px-3 py-2 text-xs font-semibold text-emerald-300 sm:flex">
              <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />
              {locale === "tr" ? "Sistem çevrimiçi" : "Systems online"}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" className="h-11 rounded-full pl-2 pr-3">
                  <span className="grid size-7 place-items-center rounded-full bg-primary/15 text-primary">
                    <CircleUser className="size-4" />
                  </span>
                  <span className="hidden max-w-32 truncate sm:inline">{profile?.display_name || "…"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => navigate("/profile")}>
                  <CircleUser /> {m.nav.profile}
                </DropdownMenuItem>
                {profile?.is_system_admin && (
                  <DropdownMenuItem onClick={() => navigate("/users")}>
                    <ShieldCheck /> {m.nav.users}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={logout}><LogOut /> {m.common.logout}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="app-content"><Outlet /></main>
      </section>

      <nav className="mobile-dock" aria-label="Primary">
        <NavLink to="/events" className={navCls}><CalendarDays /><span>{m.nav.events}</span></NavLink>
        {profile?.is_system_admin && (
          <NavLink to="/users" className={navCls}><Users /><span>{m.nav.users}</span></NavLink>
        )}
        <NavLink to="/profile" className={navCls}><UserRound /><span>{m.nav.profile}</span></NavLink>
      </nav>
    </div>
  );
}
