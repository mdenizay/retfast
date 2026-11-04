import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, MessageSquarePlus, Phone, Radio, ShieldAlert, UserPlus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { flightsApi, incidentsApi, rescueApi } from "@/lib/api/endpoints";
import type { Incident, IncidentStatus, Position } from "@/lib/api/types";

const INCIDENT_STATUSES: IncidentStatus[] = ["open", "acknowledged", "responding", "resolved", "cancelled"];
import { hasRole, isResponder, useSession } from "@/lib/auth";
import { fmtAccuracy, fmtAge, fmtAltitude, fmtCoord, fmtDateTime, fmtTime } from "@/lib/format";
import { useNow } from "@/hooks/useNow";
import { ErrorState, FormError, KeyValue, Loading, Panel } from "@/components/common";
import { FreshnessBadge, IncidentStatusBadge, TestBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapCanvas } from "@/components/map/MapCanvas";
import { freshnessFor } from "@/features/live/freshness";
import { IncidentMapLayers } from "@/features/incidents/IncidentMapLayers";
import { useIncidentStream } from "@/features/incidents/useIncidentStream";

export default function IncidentDetailPage() {
  const { id = "" } = useParams();
  const { user } = useSession();
  const responder = isResponder(user) || hasRole(user, "event_organizer");
  useIncidentStream(responder);
  const q = useQuery({
    queryKey: ["incident", id],
    queryFn: () => incidentsApi.get(id),
    refetchInterval: (query) => (query.state.data && ["open", "acknowledged", "responding"].includes(query.state.data.status) ? 10_000 : false),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <IncidentView incident={q.data} canRespond={responder && q.data.pilot.user_id !== user?.id} />;
}

function IncidentView({ incident: i, canRespond }: { incident: Incident; canRespond: boolean }) {
  const { t, lang, locale } = useI18n();
  const now = useNow(1000);
  const best = bestIncidentPosition(i);
  const lat = best?.lat;
  const lon = best?.lon;
  const acc = best?.h_acc_m ?? null;
  const posTime = best?.time ?? null;
  const ageS = posTime ? (now - Date.parse(posTime)) / 1000 : null;
  const active = ["open", "acknowledged", "responding"].includes(i.status);

  const trail = useQuery({
    queryKey: ["incident-trail", i.flight_id],
    queryFn: () => flightsApi.positions(i.flight_id!, { simplify: true, maxPages: 2 }),
    enabled: Boolean(i.flight_id),
    refetchInterval: active ? 30_000 : false,
    select: (pts: Position[]) => {
      const last = pts[pts.length - 1];
      if (!last) return pts;
      const cutoff = Date.parse(last.t) - 30 * 60 * 1000;
      return pts.filter((p) => Date.parse(p.t) >= cutoff);
    },
  });

  return (
    <div className="space-y-6">
      <Link to="/app/incidents" className="inline-flex items-center gap-1 text-footnote text-fg-secondary hover:text-fg"><ArrowLeft className="size-4" />{t("nav.incidents")}</Link>

      <header className={`rounded-lg border p-5 ${i.is_test ? "border-warning/50 bg-warning/5" : active ? "border-emergency bg-emergency/5" : "border-border bg-surface"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={i.is_test ? "warning" : "emergency"} className="font-mono tracking-wider">SOS</Badge>
          {i.is_test && <TestBadge />}
          <IncidentStatusBadge status={i.status} isTest={i.is_test} />
        </div>
        <h1 className="mt-3 text-title2 font-semibold tracking-tight">{i.pilot.full_name}</h1>
        <p className="mt-1 text-footnote text-fg-secondary tnum">
          {t("incident.received", { time: fmtDateTime(i.received_at, locale) })} · {t("incident.deviceTime", { time: fmtTime(i.created_at_device, locale) })}
        </p>
        {i.message && <p className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-body">“{i.message}”</p>}
        {i.is_test && <p className="mt-3 text-footnote font-medium text-warning">{t("incident.testNotice")}</p>}
        <AckLine incident={i} />
      </header>

      <div className="flex items-start gap-3 rounded-md border border-border bg-surface p-3 text-footnote text-fg-secondary">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-emergency-text" aria-hidden />
        <p>{t("incident.disclaimer")}</p>
      </div>

      {canRespond && active && <ResponderActions incident={i} />}

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Panel title={t("incident.lastPosition")} bodyClassName="p-0">
          {lat != null && lon != null ? (
            <>
              <div className="h-[380px]">
                <MapCanvas label={t("incident.mapLabel")} initialCenter={[lon, lat]} initialZoom={13}>
                  {(ready) => <IncidentMapLayers {...ready} lat={lat} lon={lon} accuracyM={acc} trail={trail.data ?? []} />}
                </MapCanvas>
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-border p-4 sm:grid-cols-4">
                <div>
                  <div className="text-caption text-fg-muted">{t("telemetry.age")}</div>
                  <div className="telemetry text-headline">{fmtAge(ageS, lang)}</div>
                  {ageS != null && <FreshnessBadge freshness={freshnessFor(ageS)} className="mt-1" />}
                </div>
                <div><div className="text-caption text-fg-muted">{t("telemetry.accuracy")}</div><div className="telemetry text-headline">{fmtAccuracy(acc, locale)}</div></div>
                <div><div className="text-caption text-fg-muted">{t("telemetry.gpsAlt")}</div><div className="telemetry text-headline">{fmtAltitude(best?.gps_alt_m, locale)}</div></div>
                <div><div className="text-caption text-fg-muted">{t("telemetry.position")}</div><div className="telemetry text-footnote select-all">{fmtCoord(lat, lon)}</div></div>
              </div>
            </>
          ) : (
            <p className="p-4 text-footnote text-fg-muted">{t("incident.noPosition")}</p>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title={t("incident.pilotInfo")}>
            <KeyValue
              items={[
                [t("common.name"), i.pilot.full_name],
                ...(i.pilot.public_id ? ([["ID", `@${i.pilot.public_id}`]] as [string, string][]) : []),
                ...(i.pilot.blood_type ? ([[t("pilot.bloodType"), i.pilot.blood_type]] as [string, string][]) : []),
              ]}
            />
            {i.pilot.emergency_contact_name || i.pilot.emergency_contact_phone ? (
              <div className="mt-4 rounded-md border border-border p-3">
                <div className="text-caption text-fg-muted">{t("pilot.emergencyContact")}</div>
                <div className="mt-1 font-medium">{i.pilot.emergency_contact_name || "—"}</div>
                {i.pilot.emergency_contact_phone && (
                  <a href={`tel:${i.pilot.emergency_contact_phone.replace(/\s+/g, "")}`} className="mt-1 inline-flex items-center gap-1.5 telemetry text-primary hover:underline">
                    <Phone className="size-4" aria-hidden />{i.pilot.emergency_contact_phone}
                  </a>
                )}
                <p className="mt-2 text-caption text-fg-muted">{t("incident.contactAudit")}</p>
              </div>
            ) : (
              <p className="mt-3 text-caption text-fg-muted">{t("incident.noContact")}</p>
            )}
            {i.flight_id && <Link to={`/app/flights/${i.flight_id}`} className="mt-4 inline-block text-footnote text-primary hover:underline">{t("live.openFlight")}</Link>}
          </Panel>

          <Panel title={t("incident.assignments")}>
            {(i.assignments?.length ?? 0) === 0 ? <p className="text-footnote text-fg-muted">{t("incident.noAssignments")}</p> : (
              <ul className="space-y-2">
                {i.assignments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 text-footnote">
                    <span className="font-medium">{a.responder.full_name}</span>
                    <span className="text-fg-secondary">{t(`assignment.${a.status}`)} · <span className="tnum">{fmtTime(a.updated_at, locale, false)}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel title={t("incident.timeline")}>
        {(i.updates?.length ?? 0) === 0 ? <p className="text-footnote text-fg-muted">{t("incident.noUpdates")}</p> : (
          <ol className="relative space-y-4 border-l border-border pl-5">
            {[...i.updates].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map((u) => (
              <li key={u.id} className="relative">
                <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-fg-muted" aria-hidden />
                <div className="flex flex-wrap items-baseline gap-x-2 text-footnote">
                  <span className="font-medium">{t(`incident.update.${u.kind}`)}</span>
                  {u.status && <span className="text-fg-secondary">→ {INCIDENT_STATUSES.includes(u.status as IncidentStatus) ? t(`incident.status.${u.status as IncidentStatus}`) : u.status}</span>}
                  <span className="text-fg-muted">{u.actor?.full_name ?? t("incident.system")}</span>
                  <span className="telemetry text-caption text-fg-muted">{fmtDateTime(u.created_at, locale)}</span>
                </div>
                {u.body && <p className="mt-1 whitespace-pre-line text-body text-fg-secondary">{u.body}</p>}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

/**
 * The SOS carries its own position, and the server also returns the flight's last streamed position.
 * Show whichever was recorded most recently — never an older fix just because of its source.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function bestIncidentPosition(i: Incident) {
  const a = i.last_known_position
    ? { lat: i.last_known_position.lat, lon: i.last_known_position.lon, gps_alt_m: i.last_known_position.gps_alt_m, h_acc_m: i.last_known_position.h_acc_m, time: i.last_known_position.t, source: "flight" as const }
    : null;
  const b = i.position ? { lat: i.position.lat, lon: i.position.lon, gps_alt_m: i.position.gps_alt_m, h_acc_m: i.position.h_acc_m, time: i.position.t, source: "sos" as const } : null;
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.time) >= Date.parse(a.time) ? b : a;
}

function AckLine({ incident: i }: { incident: Incident }) {
  const { t, locale } = useI18n();
  // Acknowledgement is shown ONLY when the server has set acknowledged_at.
  if (!i.acknowledged_at) {
    return i.status === "open" ? <p className="mt-3 text-footnote font-medium text-emergency-text">{t("incident.notAcknowledged")}</p> : null;
  }
  return (
    <p className="mt-3 inline-flex items-center gap-1.5 text-footnote text-fg">
      <CheckCircle2 className="size-4 text-success" aria-hidden />
      {t("incident.acknowledgedBy", { name: i.acknowledged_by?.full_name ?? "—", time: fmtTime(i.acknowledged_at, locale) })}
    </p>
  );
}

function ResponderActions({ incident: i }: { incident: Incident }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const [assignee, setAssignee] = useState("");
  const onIncident = (inc: Incident | undefined) => {
    if (inc && typeof inc === "object" && "id" in inc) qc.setQueryData(["incident", i.id], inc);
    void qc.invalidateQueries({ queryKey: ["incident", i.id] });
    void qc.invalidateQueries({ queryKey: ["incidents"] });
  };
  const ack = useMutation({ mutationFn: () => incidentsApi.acknowledge(i.id), onSuccess: onIncident });
  const responding = useMutation({ mutationFn: () => incidentsApi.setStatus(i.id, "responding"), onSuccess: onIncident });
  const resolve = useMutation({
    mutationFn: () => incidentsApi.setStatus(i.id, "resolved", resolveNote.trim()),
    onSuccess: (inc) => { setResolveOpen(false); onIncident(inc); },
  });
  const addNote = useMutation({ mutationFn: () => incidentsApi.addNote(i.id, note.trim()), onSuccess: () => { setNote(""); onIncident(undefined); } });
  const assign = useMutation({ mutationFn: () => incidentsApi.assign(i.id, assignee), onSuccess: () => { setAssignee(""); onIncident(undefined); } });
  const team = useQuery({ queryKey: ["rescue", "team"], queryFn: rescueApi.team, retry: false });

  useEffect(() => {
    if (!resolveOpen) resolve.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveOpen]);

  function submitNote(e: FormEvent) {
    e.preventDefault();
    if (note.trim()) addNote.mutate();
  }

  const assignedIds = new Set(i.assignments?.filter((a) => a.status !== "withdrawn" && a.status !== "completed").map((a) => a.responder.user_id));
  const candidates = (team.data?.items ?? []).filter((m) => !assignedIds.has(m.user_id));

  return (
    <Panel title={t("incident.actions")}>
      <div className="flex flex-wrap gap-2">
        {i.status === "open" && (
          <Button variant="emergency" size="lg" onClick={() => ack.mutate()} disabled={ack.isPending}>
            <CheckCircle2 /> {ack.isPending ? t("common.wait") : t("incident.acknowledge")}
          </Button>
        )}
        {(i.status === "open" || i.status === "acknowledged") && (
          <Button size="lg" variant={i.status === "acknowledged" ? "default" : "outline"} onClick={() => responding.mutate()} disabled={responding.isPending}>
            <Radio /> {t("incident.setResponding")}
          </Button>
        )}
        <Button size="lg" variant="outline" onClick={() => setResolveOpen(true)}>{t("incident.resolve")}</Button>
      </div>
      <div className="mt-3 space-y-2">
        <FormError error={ack.error} />
        <FormError error={responding.error} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <form onSubmit={submitNote} className="space-y-2">
          <label htmlFor="inc-note" className="text-footnote font-medium text-fg-secondary">{t("incident.addNote")}</label>
          <Textarea id="inc-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          <FormError error={addNote.error} />
          <Button type="submit" variant="outline" disabled={!note.trim() || addNote.isPending}><MessageSquarePlus /> {t("incident.saveNote")}</Button>
        </form>
        <div className="space-y-2">
          <div className="text-footnote font-medium text-fg-secondary">{t("incident.assign")}</div>
          {team.error ? (
            <p className="text-caption text-fg-muted">{t("incident.teamUnavailable")}</p>
          ) : (
            <div className="flex gap-2">
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="flex-1" aria-label={t("incident.assign")}><SelectValue placeholder={t("incident.pickResponder")} /></SelectTrigger>
                <SelectContent>
                  {candidates.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name} · {t(m.availability === "available" ? "rescue.available" : "rescue.unavailable")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => assign.mutate()} disabled={!assignee || assign.isPending}><UserPlus /> {t("incident.assignBtn")}</Button>
            </div>
          )}
          {!team.error && !team.isLoading && candidates.length === 0 && <p className="text-caption text-fg-muted">{t("incident.noCandidates")}</p>}
          <FormError error={assign.error} />
        </div>
      </div>

      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("incident.resolveTitle")}</DialogTitle>
            <DialogDescription>{t("incident.resolveBody")}</DialogDescription>
          </DialogHeader>
          <label htmlFor="resolve-note" className="text-footnote font-medium text-fg-secondary">{t("incident.resolveNote")}</label>
          <Textarea id="resolve-note" value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} rows={3} />
          <FormError error={resolve.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={() => resolve.mutate()} disabled={resolve.isPending}>{t("incident.resolveConfirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
