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
import { CircleUser, Globe, Navigation } from "lucide-react";

export default function Layout() {
  const { profile } = useAuth();
  const { m, locale, setLocale } = useI18n();
  const navigate = useNavigate();

  const navCls = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
      isActive ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
    }`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-white/8 bg-background/82 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link to="/events" className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl border border-white/15 bg-black text-white shadow-lg shadow-black/30">
              <Navigation className="size-5 fill-current" />
            </span>
            <span className="brand-wordmark text-lg">RET<span className="text-primary">FAST</span></span>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/events" className={navCls}>
              {m.nav.events}
            </NavLink>
            {profile?.is_system_admin && (
              <NavLink to="/users" className={navCls}>
                {m.nav.users}
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Globe className="size-4" />
                  {locale.toUpperCase()}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {LOCALES.map((l) => (
                  <DropdownMenuItem key={l} onClick={() => setLocale(l)}>
                    {l === "en" ? "English" : "Türkçe"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <CircleUser className="size-4" />
                  {profile?.display_name || "…"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate("/profile")}>
                  {m.nav.profile}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => {
                    await supabase.auth.signOut();
                    navigate("/login");
                  }}
                >
                  {m.common.logout}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
