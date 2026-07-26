import { ArrowRight, CheckCircle2, KeyRound, LogOut, Map, RadioTower } from "lucide-react";
import { Link } from "react-router-dom";

import { BrandMark } from "../components/BrandMark";
import { PreferencesBar } from "../components/PreferencesBar";
import { useAuth } from "../contexts/AuthContext";
import { useLocale } from "../i18n";

export function DashboardPage() {
  const { user, signOut } = useAuth();
  const { copy } = useLocale();

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <BrandMark />
        <div className="dashboard-actions">
          <PreferencesBar />
          <button className="ghost-button" type="button" onClick={() => void signOut()}><LogOut size={17} />{copy.signOut}</button>
        </div>
      </header>
      <section className="dashboard-hero">
        <div>
          <span className="eyebrow"><CheckCircle2 size={15} />{copy.foundationReady}</span>
          <h1>{copy.dashboardGreeting}, {user?.displayName || user?.email?.split("@")[0]}.</h1>
          <p>{copy.dashboardDescription}</p>
        </div>
        <div className="dashboard-orbit" aria-hidden="true"><RadioTower /><span /><span /></div>
      </section>
      <section className="dashboard-grid">
        <article className="dashboard-card feature-card">
          <div className="card-icon"><Map /></div>
          <div><h2>{copy.foundationReady}</h2><p>{copy.foundationText}</p></div>
          <ArrowRight className="card-arrow" />
        </article>
        <article className="dashboard-card account-card">
          <span className="avatar large-avatar">{(user?.displayName || user?.email || "RF").slice(0, 2).toUpperCase()}</span>
          <div><strong>{user?.displayName || "RETFAST User"}</strong><small>{user?.email}</small></div>
          <Link className="secondary-button" to="/change-password"><KeyRound size={16} />{copy.changePassword}</Link>
        </article>
      </section>
    </main>
  );
}
