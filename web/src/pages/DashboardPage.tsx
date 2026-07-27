import {
  Activity,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../contexts/AuthContext";
import { useLocale } from "../i18n";
import { applyToEventCommand, type EventView, useEvents } from "../lib/events";

function formatDate(event: EventView, locale: "tr" | "en") {
  const formatter = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: event.timezone,
  });
  return formatter.format(event.startsAt.toDate());
}

export function DashboardPage() {
  const { user, profile } = useAuth();
  const { copy, locale } = useLocale();
  const { events, memberships, membershipByEvent, loading, error } = useEvents();
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const isSuperadmin = profile?.globalRole === "superadmin";
  const activeCount = events.filter((event) => event.status === "active").length;
  const approvedCount = memberships.filter((member) => member.status === "approved").length;

  async function apply(eventId: string) {
    setApplyingId(eventId);
    setCommandError(null);
    try {
      await applyToEventCommand(eventId);
    } catch {
      setCommandError(copy.commandFailed);
    } finally {
      setApplyingId(null);
    }
  }

  return (
    <main className="app-content">
      <section className="operations-hero">
        <div>
          <span className="eyebrow"><Activity size={15} />{copy.operationsCenter}</span>
          <h1>{copy.dashboardGreeting}, {profile?.displayName || user?.displayName || user?.email?.split("@")[0]}.</h1>
          <p>{copy.eventsDescription}</p>
        </div>
        {isSuperadmin && <Link className="primary-button hero-action" to="/app/events/new"><Plus size={18} />{copy.createEvent}</Link>}
      </section>

      <section className="metric-grid" aria-label={copy.summary}>
        <article><span className="metric-icon"><CalendarDays /></span><div><strong>{events.length}</strong><small>{copy.visibleEvents}</small></div></article>
        <article><span className="metric-icon active"><Activity /></span><div><strong>{activeCount}</strong><small>{copy.activeEvents}</small></div></article>
        <article><span className="metric-icon"><ShieldCheck /></span><div><strong>{approvedCount}</strong><small>{copy.myAssignments}</small></div></article>
      </section>

      <section className="section-heading">
        <div><span className="section-kicker">{copy.eventOperations}</span><h2>{copy.events}</h2></div>
        {isSuperadmin && <span className="role-pill"><ShieldCheck size={14} />{copy.superadmin}</span>}
      </section>

      {(error || commandError) && <div className="inline-alert error">{commandError || error}</div>}
      {loading ? (
        <div className="content-loader"><span />{copy.loadingEvents}</div>
      ) : events.length === 0 ? (
        <section className="empty-state"><CalendarDays /><h3>{copy.noEvents}</h3><p>{copy.noEventsText}</p>{isSuperadmin && <Link className="primary-button" to="/app/events/new"><Plus size={17} />{copy.createFirstEvent}</Link>}</section>
      ) : (
        <section className="event-grid">
          {events.map((event) => {
            const membership = membershipByEvent.get(event.id);
            const canManage = isSuperadmin || event.managerIds.includes(user?.uid ?? "");
            return (
              <article className="event-card" key={event.id}>
                <div className="event-card-top"><span className={`status-pill status-${event.status}`}>{copy[event.status]}</span><span className="visibility-label">{copy[event.visibility]}</span></div>
                <div className="event-card-copy"><h3>{event.name}</h3><p>{event.description || copy.noDescription}</p></div>
                <dl className="event-meta"><div><MapPin /><dt>{copy.venue}</dt><dd>{event.venue}</dd></div><div><Clock3 /><dt>{copy.starts}</dt><dd>{formatDate(event, locale)}</dd></div><div><Users /><dt>{copy.participants}</dt><dd>{event.participantCount}</dd></div></dl>
                <footer className="event-card-footer">
                  {membership ? <span className={`membership-pill membership-${membership.status}`}><CheckCircle2 size={14} />{membership.role ? copy[membership.role] : copy[membership.status]}</span> : <span />}
                  {canManage ? (
                    <Link className="secondary-button" to={`/app/events/${event.id}`}>{copy.manage}<ArrowRight size={15} /></Link>
                  ) : membership ? (
                    <Link className="secondary-button" to={`/app/events/${event.id}`}>{copy.details}<ArrowRight size={15} /></Link>
                  ) : (
                    <button className="primary-button compact-button" disabled={applyingId === event.id} type="button" onClick={() => void apply(event.id)}>{applyingId === event.id ? copy.applying : copy.apply}</button>
                  )}
                </footer>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
