import { lazy, Suspense, useDeferredValue, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Mountain, Search, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { eventsApi, usersApi, type EventInput } from "@/lib/api/endpoints";
import type { LatLon, LaunchSite } from "@/lib/api/types";
import { fmtCoord } from "@/lib/format";
import { ErrorState, Field, FormError, Loading, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EventForm } from "@/features/events/EventForm";
import { useEventContext } from "@/features/events/context";

const PointPicker = lazy(() => import("@/features/events/PointPicker").then((m) => ({ default: m.PointPicker })));

export default function EventSettingsPage() {
  const { t } = useI18n();
  const { event: e, access, refetch } = useEventContext();
  const qc = useQueryClient();
  const loc = useLocation();
  const created = Boolean((loc.state as { created?: boolean } | null)?.created);
  const [saved, setSaved] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const update = useMutation({
    mutationFn: (input: EventInput) => eventsApi.update(e.id, input),
    onSuccess: (ev) => {
      qc.setQueryData(["app", "event", e.id], ev);
      void qc.invalidateQueries({ queryKey: ["app", "events"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });
  const archive = useMutation({
    mutationFn: () => eventsApi.archive(e.id),
    onSuccess: () => {
      setConfirmArchive(false);
      refetch();
    },
  });

  return (
    <div className="space-y-6">
      {created && (
        <div role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-footnote text-fg">{t("evsettings.created")}</div>
      )}
      <Organizers highlight={created || e.organizers.length === 0} canEdit={access.admin} />
      {saved && <div role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-footnote text-success">{t("common.saved")}</div>}
      <EventForm key={e.updated_at} event={e} onSubmit={(i) => update.mutate(i)} submitLabel={t("common.save")} busy={update.isPending} error={update.error} />
      <LaunchSites />
      {e.status !== "archived" && (
        <Panel title={t("event.dangerZone")}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-footnote text-fg-secondary">{t("event.archiveHint")}</p>
            <Button variant="destructive" onClick={() => setConfirmArchive(true)}><Archive /> {t("event.archive")}</Button>
          </div>
        </Panel>
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

/** Organizers: assigned by platform admins only (contract: POST/DELETE /events/{id}/organizers). */
function Organizers({ highlight, canEdit }: { highlight: boolean; canEdit: boolean }) {
  const { t } = useI18n();
  const { event: e, refetch } = useEventContext();
  const ref = useRef<HTMLElement>(null);
  const loc = useLocation();
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim());
  const search = useQuery({ queryKey: ["users", "search", dq], queryFn: () => usersApi.search(dq), enabled: canEdit && dq.length >= 2 });
  const add = useMutation({ mutationFn: (userId: string) => eventsApi.addOrganizer(e.id, userId), onSuccess: () => { setQ(""); refetch(); } });
  const remove = useMutation({ mutationFn: (userId: string) => eventsApi.removeOrganizer(e.id, userId), onSuccess: refetch });
  useEffect(() => {
    if (loc.hash === "#organizers") ref.current?.scrollIntoView({ block: "start" });
  }, [loc.hash]);
  const ids = new Set(e.organizers.map((o) => o.user_id));

  return (
    <section ref={ref} id="organizers" className={highlight ? "rounded-lg ring-2 ring-primary/40" : undefined}>
      <Panel title={<span className="inline-flex items-center gap-2"><ShieldCheck className="size-4" aria-hidden />{t("evsettings.organizers")}</span>} bodyClassName="p-0">
        {e.organizers.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-3 text-footnote text-warning"><TriangleAlert className="size-4" aria-hidden />{t("evsettings.noOrganizers")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {e.organizers.map((o) => (
              <li key={o.user_id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex-1 font-medium">{o.full_name}</span>
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(o.user_id)} disabled={remove.isPending} aria-label={t("evsettings.removeOrganizer", { name: o.full_name })}>
                    <Trash2 /> {t("common.remove")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <div className="space-y-3 border-t border-border p-4">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
              <Input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder={t("evsettings.searchOrganizer")} aria-label={t("evsettings.searchOrganizer")} className="pl-9" />
            </div>
            {dq.length >= 2 && (search.isLoading ? <Loading /> : search.error ? <ErrorState error={search.error} /> : (
              <ul className="max-w-md divide-y divide-border rounded-md border border-border">
                {(search.data?.items ?? []).slice(0, 8).map((u) => (
                  <li key={u.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{u.full_name}</div>
                      <div className="truncate text-caption text-fg-muted">{u.email}</div>
                    </div>
                    {ids.has(u.id) ? <span className="text-caption text-fg-muted">{t("evsettings.alreadyOrganizer")}</span> : (
                      <Button size="sm" variant="outline" onClick={() => add.mutate(u.id)} disabled={add.isPending}>{t("evsettings.makeOrganizer")}</Button>
                    )}
                  </li>
                ))}
                {(search.data?.items ?? []).length === 0 && <li className="px-3 py-2 text-footnote text-fg-muted">{t("members.noResults")}</li>}
              </ul>
            ))}
            <FormError error={add.error ?? remove.error} />
          </div>
        ) : (
          <p className="border-t border-border px-4 py-2.5 text-caption text-fg-muted">{t("evsettings.organizersAdminOnly")}</p>
        )}
      </Panel>
    </section>
  );
}

function LaunchSites() {
  const { t } = useI18n();
  const { event } = useEventContext();
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

  function submit(ev: FormEvent) {
    ev.preventDefault();
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
          <Field id="site-name" label={t("site.name")}><Input id="site-name" value={name} onChange={(ev) => setName(ev.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="site-elev" label={t("site.elevation")}><Input id="site-elev" inputMode="numeric" className="telemetry" value={elev} onChange={(ev) => setElev(ev.target.value.replace(/[^\d.-]/g, ""))} /></Field>
            <Field id="site-notes" label={t("site.notes")}><Input id="site-notes" value={notes} onChange={(ev) => setNotes(ev.target.value)} /></Field>
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
