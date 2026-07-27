import { ArrowLeft, CalendarDays, FileText, MapPin, Save, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { FormField } from "../components/FormField";
import type { EventVisibility } from "../domain";
import { useLocale } from "../i18n";
import { createEventCommand } from "../lib/events";

function localInputValue(date: Date) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

export function CreateEventPage() {
  const { copy } = useLocale();
  const navigate = useNavigate();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [venue, setVenue] = useState("");
  const [startsAt, setStartsAt] = useState(localInputValue(tomorrow));
  const [endsAt, setEndsAt] = useState(localInputValue(new Date(tomorrow.getTime() + 8 * 3_600_000)));
  const [visibility, setVisibility] = useState<EventVisibility>("public");
  const [managerEmail, setManagerEmail] = useState("");
  const [publish, setPublish] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await createEventCommand({
        name,
        description,
        venue,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Istanbul",
        visibility,
        status: publish ? "published" : "draft",
        ...(managerEmail.trim() ? { managerEmail: managerEmail.trim() } : {}),
      });
      navigate(`/app/events/${result.eventId}`);
    } catch {
      setError(copy.commandFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="app-content narrow-content">
      <Link className="back-link" to="/app"><ArrowLeft size={16} />{copy.backToEvents}</Link>
      <section className="page-title"><span className="section-kicker">{copy.superadmin}</span><h1>{copy.createEvent}</h1><p>{copy.createEventDescription}</p></section>
      <form className="editor-card" onSubmit={(event) => void submit(event)}>
        <div className="form-section"><h2>{copy.eventInformation}</h2><div className="editor-grid">
          <FormField id="event-name" icon={CalendarDays} label={copy.eventName} value={name} onChange={(event) => setName(event.target.value)} required />
          <FormField id="event-venue" icon={MapPin} label={copy.venue} value={venue} onChange={(event) => setVenue(event.target.value)} required />
        </div><label className="form-field"><span className="field-label">{copy.description}</span><span className="textarea-wrap"><FileText size={18} /><textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></span></label></div>
        <div className="form-section"><h2>{copy.schedule}</h2><div className="editor-grid"><FormField id="starts-at" icon={CalendarDays} label={copy.starts} type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /><FormField id="ends-at" icon={CalendarDays} label={copy.ends} type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /></div></div>
        <div className="form-section"><h2>{copy.accessAndManager}</h2><div className="editor-grid"><label className="form-field"><span className="field-label">{copy.visibility}</span><span className="select-wrap"><select value={visibility} onChange={(event) => setVisibility(event.target.value as EventVisibility)}><option value="public">{copy.public}</option><option value="unlisted">{copy.unlisted}</option><option value="private">{copy.private}</option></select></span></label><FormField id="manager-email" icon={UserRound} label={copy.managerEmailOptional} type="email" value={managerEmail} onChange={(event) => setManagerEmail(event.target.value)} /></div><label className="switch-row"><input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} /><span><strong>{copy.publishNow}</strong><small>{copy.publishNowHint}</small></span></label></div>
        {error && <div className="inline-alert error">{error}</div>}
        <footer className="editor-actions"><Link className="secondary-button" to="/app">{copy.cancel}</Link><button className="primary-button" disabled={submitting} type="submit"><Save size={17} />{submitting ? copy.saving : copy.createEvent}</button></footer>
      </form>
    </main>
  );
}
