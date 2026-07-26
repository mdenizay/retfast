import { CalendarDays, KeyRound, LogOut } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../contexts/AuthContext";
import { useLocale } from "../i18n";
import { BrandMark } from "./BrandMark";
import { PreferencesBar } from "./PreferencesBar";

export function AppShell() {
  const { profile, user, signOut } = useAuth();
  const { copy } = useLocale();
  const initials = (profile?.displayName || user?.displayName || user?.email || "RF")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="app-shell">
      <header className="dashboard-header app-shell-header">
        <Link to="/app" aria-label="RETFAST"><BrandMark /></Link>
        <nav className="app-nav" aria-label={copy.navigation}>
          <NavLink to="/app" end><CalendarDays size={16} />{copy.events}</NavLink>
          <NavLink to="/change-password"><KeyRound size={16} />{copy.account}</NavLink>
        </nav>
        <div className="dashboard-actions">
          <PreferencesBar />
          <div className="profile-chip"><span className="avatar">{initials}</span><span><strong>{profile?.displayName || user?.displayName}</strong><small>{profile?.globalRole === "superadmin" ? copy.superadmin : user?.email}</small></span></div>
          <button className="icon-button" type="button" onClick={() => void signOut()} aria-label={copy.signOut}><LogOut size={18} /></button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
