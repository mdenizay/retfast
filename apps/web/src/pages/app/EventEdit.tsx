import { lazy, Suspense, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ExternalLink, Map as MapIcon, Mountain, Trash2, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { eventsApi, type EventInput } from "@/lib/api/endpoints";
import type { LatLon, LaunchSite, RfEvent } from "@/lib/api/types";
import { hasRole, useSession } from "@/lib/auth";
import { fmtCoord } from "@/lib/format";
import { ErrorState, Field, FormError, Loading, PageHeader, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EventForm } from "@/features/events/EventForm";
import { DemoBadge, EventStatusBadge } from "@/features/events/EventBits";

const PointPicker = lazy(() => import("@/features/events/PointPicker").then((m) => ({ default: m.PointPicker })));

export default function EventEditPage() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const { user } = useSession();
  const qc = useQueryClient();
  const event = useQuery({ queryKey: ["app", "event", id], queryFn: () => eventsApi.get(id) });
  const [saved, setSaved] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const update = useMutation({
    mutationFn: (input: EventInput) => eventsApi.update(id, input),
    onSuccess: (ev) => {
      qc.setQueryData(["app", "event", id], ev);
      void qc.invalidateQueries({ queryKey: ["app", "events"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });
  const archive = useMutation({
    mutationFn: () => eventsApi.archive(id),
    onSuccess: (ev) => {
      if (ev) qc.setQueryData(["app", "event", id], ev);
      else void qc.invalidateQueries({ queryKey: ["app", "event", id] });
      setConfirmArchive(false);
    },
  });

  if (event.isLoading) return <Loading />;
  if (event.error || !event.data) return <ErrorState error={event.error} onRetry={() => void event.refetch()} />;
  const e = event.data;
  const canEdit = e.my_role === "organizer" || hasRole(user, "platform_admin");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-2"><EventStatusBadge status={e.status} />{e.is_demo && <DemoBadge />}</span>}
        title={e.name}
        subtitle={e.location_name}
        actions={
          <>
            {e.settings.live_tracking && <Button asChild><Link to={`/app/events/${e.id}/live`}><MapIcon /> {t("event.live")}</Link></Button>}
            <Button asChild variant="outline"><Link to={`/app/events/${e.id}/participants`}><Users /> {t("event.participants")}</Link></Button>
            <Button asChild variant="ghost"><Link to={`/events/${e.slug}`}><ExternalLink /> {t("event.publicPage")}</Link></Button>
          </>
        }
      />
      {!canEdit ? (
        <Panel title={t("event.details")}>
          <p className="text-footnote text-fg-secondary">{t("event.readOnly")}</p>
          {e.description && <p className="mt-3 whitespace-pre-line">{e.description}</p>}
        </Panel>
      ) : (
        <>
          {saved && <div role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-footnote text-success">{t("common.saved")}</div>}
          <EventForm key={e.updated_at} event={e} onSubmit={(i) => update.mutate(i)} submitLabel={t("common.save")} busy={update.isPending} error={update.error} />
          <LaunchSites event={e} />
          {e.status !== "archived" && (
            <Panel title={t("event.dangerZone")}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-footnote text-fg-secondary">{t("event.archiveHint")}</p>
                <Button variant="destructive" onClick={() => setConfirmArchive(true)}><Archive /> {t("event.archive")}</Button>
              </div>
            </Panel>
          )}
        </>
      )}
      <Dialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("event.archiveConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("event.archiveConfirmBody", { name: e.name })}</DialogDescription>
          </DialogHeader>
          <FormError error={archive.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmArchive(false)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => archive.mutate()} disabled={archive.isPending}>{t("event.archive")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LaunchSites({ event }: { event: RfEvent }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const key = ["app", "sites", event.id];
  const sites = useQuery({ queryKey: key, queryFn: () => eventsApi.launchSites(event.id) });
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [elev, setElev] = useState("");
  const [pos, setPos] = useState<LatLon | null>(null);
  const [verified, setVerified] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      eventsApi.createLaunchSite(event.id, {
        name: name.trim(), notes, position: pos, elevation_m: elev ? Number(elev) : null, is_verified: verified,
      }),
    onSuccess: () => {
      setName(""); setNotes(""); setElev(""); setPos(null); setVerified(false);
      void qc.invalidateQueries({ queryKey: key });
    },
  });
  const remove = useMutation({
    mutationFn: (s: LaunchSite) => eventsApi.deleteLaunchSite(event.id, s.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const toggleVerified = useMutation({
    mutationFn: (s: LaunchSite) => eventsApi.updateLaunchSite(event.id, s.id, { is_verified: !s.is_verified }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate();
  }

  const list = sites.data ?? [];
  return (
    <Panel title={t("event.launchSites")}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          {sites.isLoading ? <Loading /> : sites.error ? <ErrorState error={sites.error} /> : list.length === 0 ? (
            <p className="text-footnote text-fg-muted">{t("event.noSites")}</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {list.map((s) => (
                <li key={s.id} className="flex items-start gap-3 px-3 py-3">
                  <Mountain className="mt-0.5 size-4 text-fg-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      {s.is_verified ? <Badge variant="success">{t("site.verified")}</Badge> : <Badge variant="warning">{t("site.unverified")}</Badge>}
                    </div>
                    <div className="telemetry text-caption text-fg-muted">
                      {s.position ? fmtCoord(s.position.lat, s.position.lon) : t("site.noCoords")}{s.elevation_m != null ? ` · ${s.elevation_m} m` : ""}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => toggleVerified.mutate(s)}>{s.is_verified ? t("site.markUnverified") : t("site.markVerified")}</Button>
                  <Button size="icon-sm" variant="ghost" aria-label={t("common.delete")} onClick={() => remove.mutate(s)}><Trash2 /></Button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3"><FormError error={remove.error ?? toggleVerified.error} /></div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <h3 className="text-body font-semibold">{t("site.add")}</h3>
          <Field id="site-name" label={t("site.name")}><Input id="site-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="site-elev" label={t("site.elevation")}><Input id="site-elev" inputMode="numeric" className="telemetry" value={elev} onChange={(e) => setElev(e.target.value.replace(/[^\d.-]/g, ""))} /></Field>
            <Field id="site-notes" label={t("site.notes")}><Input id="site-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          <div className="text-footnote text-fg-secondary">
            {pos ? <span className="telemetry">{fmtCoord(pos.lat, pos.lon)}</span> : t("site.clickMap")}
            {pos && <button type="button" className="ml-2 text-primary hover:underline" onClick={() => setPos(null)}>{t("common.clear")}</button>}
          </div>
          <Suspense fallback={<Loading />}>
            <PointPicker
              value={pos}
              onChange={setPos}
              center={event.center}
              label={t("site.clickMap")}
              points={list.filter((s) => s.position).map((s) => ({ id: s.id, label: s.name, lat: s.position!.lat, lon: s.position!.lon, verified: s.is_verified }))}
            />
          </Suspense>
          <div className="flex items-center gap-2">
            <Checkbox id="site-verified" checked={verified} onCheckedChange={(c) => setVerified(c === true)} />
            <Label htmlFor="site-verified">{t("site.verifiedCheck")}</Label>
          </div>
          <p className="text-caption text-fg-muted">{t("site.verifyHint")}</p>
          <FormError error={create.error} />
          <Button type="submit" disabled={!name.trim() || create.isPending}>{t("site.add")}</Button>
        </form>
      </div>
    </Panel>
  );
}
