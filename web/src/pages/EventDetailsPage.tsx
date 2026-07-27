import {
  ArrowLeft,
  CalendarDays,
  Check,
  Clock3,
  Mail,
  MapPin,
  Plus,
  ShieldCheck,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { lazy, Suspense, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { FormField } from "../components/FormField";
import { useAuth } from "../contexts/AuthContext";
import type { EventRole } from "../domain";
import { useLocale } from "../i18n";
import {
  applyToEventCommand,
  inviteEventMemberCommand,
  reviewMembershipCommand,
  setEventManagerCommand,
  updateEventCommand,
  useEvent,
  useEventMembers,
  useEvents,
} from "../lib/events";

type AssignableRole = Exclude<EventRole, "manager">;
const roles: AssignableRole[] = ["pilot", "retriever", "observer"];
const LiveOperationsMap = lazy(() =>
  import("../components/LiveOperationsMap").then((module) => ({
    default: module.LiveOperationsMap,
  })),
);

export function EventDetailsPage() {
  const { eventId } = useParams();
  const { user, profile } = useAuth();
  const { copy, locale } = useLocale();
  const { event, loading } = useEvent(eventId);
  const { membershipByEvent } = useEvents();
  const membership = eventId ? membershipByEvent.get(eventId) : undefined;
  const isSuperadmin = profile?.globalRole === "superadmin";
  const canManage = Boolean(event && (isSuperadmin || event.managerIds.includes(user?.uid ?? "")));
  const canOperate = canManage || Boolean(
    membership?.status === "approved" && membership.role === "observer",
  );
  const { members } = useEventMembers(eventId, canManage);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<AssignableRole>("pilot");
  const [managerEmail, setManagerEmail] = useState("");
  const [rolesByUser, setRolesByUser] = useState<Record<string, AssignableRole>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  async function run(key: string, command: () => Promise<unknown>) {
    setBusy(key);
    setMessage(null);
    try {
      await command();
      setMessage(copy.commandCompleted);
    } catch {
      setMessage(copy.commandFailed);
    } finally {
      setBusy(null);
    }
  }

  async function addMember(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!eventId) return;
    await run("add-member", () => inviteEventMemberCommand(eventId, memberEmail, memberRole));
    setMemberEmail("");
  }

  async function assignManager(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!eventId) return;
    await run("manager", () => setEventManagerCommand(eventId, managerEmail));
    setManagerEmail("");
  }

  if (loading) return <main className="app-content"><div className="content-loader"><span />{copy.loadingEvents}</div></main>;
  if (!event || !eventId) return <main className="app-content"><section className="empty-state"><CalendarDays /><h3>{copy.eventNotFound}</h3><Link className="secondary-button" to="/app">{copy.backToEvents}</Link></section></main>;

  return (
    <main className="app-content">
      <Link className="back-link" to="/app"><ArrowLeft size={16} />{copy.backToEvents}</Link>
      <section className="event-detail-hero">
        <div><div className="event-card-top"><span className={`status-pill status-${event.status}`}>{copy[event.status]}</span><span className="visibility-label">{copy[event.visibility]}</span></div><h1>{event.name}</h1><p>{event.description || copy.noDescription}</p></div>
        {canManage && <div className="status-actions">{event.status === "draft" && <button className="primary-button" type="button" disabled={busy === "status"} onClick={() => void run("status", () => updateEventCommand({ eventId, status: "published" }))}>{copy.publish}</button>}{event.status !== "cancelled" && event.status !== "completed" && <button className="danger-button" type="button" disabled={busy === "status"} onClick={() => void run("status", () => updateEventCommand({ eventId, status: "cancelled" }))}>{copy.cancelEvent}</button>}</div>}
      </section>
      <section className="event-detail-meta"><article><MapPin /><span><small>{copy.venue}</small><strong>{event.venue}</strong></span></article><article><CalendarDays /><span><small>{copy.starts}</small><strong>{dateFormatter.format(event.startsAt.toDate())}</strong></span></article><article><Clock3 /><span><small>{copy.ends}</small><strong>{dateFormatter.format(event.endsAt.toDate())}</strong></span></article><article><Users /><span><small>{copy.participants}</small><strong>{event.participantCount}</strong></span></article></section>

      {message && <div className={`inline-alert ${message === copy.commandCompleted ? "success" : "error"}`}>{message}</div>}

      {!canManage && (
        <section className="panel-card"><div><span className="section-kicker">{copy.myApplication}</span><h2>{membership ? copy[membership.status] : copy.notApplied}</h2><p>{membership?.role ? `${copy.assignedRole}: ${copy[membership.role]}` : copy.applicationExplanation}</p></div>{!membership && event.visibility === "public" && ["published", "active"].includes(event.status) && <button className="primary-button" disabled={busy === "apply"} type="button" onClick={() => void run("apply", () => applyToEventCommand(eventId))}>{copy.apply}</button>}</section>
      )}

      {canOperate && (
        <Suspense fallback={<div className="content-loader"><span />{copy.loadingLive}</div>}>
          <LiveOperationsMap eventId={eventId} />
        </Suspense>
      )}

      {canManage && (
        <>
          <div className="management-layout">
          <section className="members-panel"><div className="section-heading compact-heading"><div><span className="section-kicker">{copy.eventTeam}</span><h2>{copy.membersAndApplications}</h2></div><span className="count-badge">{members.length}</span></div><div className="member-list">
            {members.length === 0 ? <p className="muted-copy">{copy.noMembers}</p> : members.map((member) => {
              const selectedRole = rolesByUser[member.userId] ?? member.role ?? "pilot";
              return <article className="member-row" key={member.id}><span className="avatar large-avatar">{member.displayName.slice(0, 2).toUpperCase()}</span><div className="member-identity"><strong>{member.displayName}</strong><small>{member.email}</small></div><span className={`membership-pill membership-${member.status}`}>{member.role ? copy[member.role] : copy[member.status]}</span>{member.status === "pending" && <div className="review-actions"><select value={selectedRole} onChange={(changeEvent) => setRolesByUser((current) => ({ ...current, [member.userId]: changeEvent.target.value as AssignableRole }))}>{roles.map((role) => <option key={role} value={role}>{copy[role]}</option>)}</select><button className="approve-icon" aria-label={copy.approve} disabled={busy === member.userId} type="button" onClick={() => void run(member.userId, () => reviewMembershipCommand(eventId, member.userId, "approved", selectedRole))}><Check size={16} /></button><button className="reject-icon" aria-label={copy.reject} disabled={busy === member.userId} type="button" onClick={() => void run(member.userId, () => reviewMembershipCommand(eventId, member.userId, "rejected"))}><X size={16} /></button></div>}</article>;
            })}
          </div></section>
          <aside className="management-sidebar"><form className="panel-card stacked-card" onSubmit={(formEvent) => void addMember(formEvent)}><span className="panel-icon"><Plus /></span><h3>{copy.addParticipant}</h3><p>{copy.addParticipantHint}</p><FormField id="member-email" icon={Mail} label={copy.email} type="email" value={memberEmail} onChange={(inputEvent) => setMemberEmail(inputEvent.target.value)} required /><label className="form-field"><span className="field-label">{copy.role}</span><span className="select-wrap"><select value={memberRole} onChange={(changeEvent) => setMemberRole(changeEvent.target.value as AssignableRole)}>{roles.map((role) => <option key={role} value={role}>{copy[role]}</option>)}</select></span></label><button className="primary-button full-button" disabled={busy === "add-member"} type="submit">{copy.addToEvent}</button></form>
          {isSuperadmin && <form className="panel-card stacked-card" onSubmit={(formEvent) => void assignManager(formEvent)}><span className="panel-icon"><UserCog /></span><h3>{copy.assignManager}</h3><p>{copy.assignManagerHint}</p><FormField id="manager-email-detail" icon={Mail} label={copy.managerEmail} type="email" value={managerEmail} onChange={(inputEvent) => setManagerEmail(inputEvent.target.value)} required /><button className="secondary-button full-button" disabled={busy === "manager"} type="submit"><ShieldCheck size={16} />{copy.assign}</button></form>}
          </aside>
          </div>
        </>
      )}
    </main>
  );
}
