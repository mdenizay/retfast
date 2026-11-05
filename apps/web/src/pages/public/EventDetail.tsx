import { useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, Map as MapIcon, MapPin, Monitor, Mountain, Settings2, Smartphone } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { eventsApi } from "@/lib/api/endpoints";
import { useSession } from "@/lib/auth";
import { eventAccess, myEventRoles } from "@/lib/roles";
import { MEMBER_ROLES, type RfEvent } from "@/lib/api/types";
import { fmtCoord, fmtDateTime } from "@/lib/format";
import { WeatherPanel } from "@/features/events/WeatherPanel";
import { ErrorState, Field, FormError, KeyValue, Loading, Panel } from "@/components/common";
import { ApplicationStatusBadge, RoleBadge } from "@/components/status";
import { ROLE_ICON } from "@/components/stateIcons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DemoBadge, EventStatusBadge } from "@/features/events/EventBits";

export default function PublicEventDetailPage() {
  const { slug = "" } = useParams();
  const { t, locale } = useI18n();
  const { user } = useSession();
  const event = useQuery({ queryKey: ["public", "event", slug, user?.id ?? null], queryFn: () => eventsApi.get(slug) });
  const sites = useQuery({
    queryKey: ["public", "sites", event.data?.id],
    queryFn: () => eventsApi.launchSites(event.data!.id),
    enabled: Boolean(event.data?.id),
  });

  if (event.isLoading) return <div className="mx-auto max-w-6xl px-4 sm:px-6"><Loading /></div>;
  if (event.error || !event.data) return <div className="mx-auto max-w-3xl px-4 py-16"><ErrorState error={event.error} onRetry={() => void event.refetch()} /></div>;
  const e = event.data;
  const publicLive = e.settings.live_tracking && e.settings.public_live_map;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <EventStatusBadge status={e.status} />
        {e.is_demo && <DemoBadge />}
        {e.visibility === "restricted" && <Badge variant="muted">{t("event.restricted")}</Badge>}
      </div>
      <h1 className="mt-3 text-title1 font-semibold tracking-tight">{e.name}</h1>
      {e.location_name && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-body text-fg-secondary"><MapPin className="size-4" aria-hidden />{e.location_name}</p>
      )}
      {publicLive && (
        <div className="mt-6">
          <Button asChild size="lg"><Link to={`/events/${e.slug}/live`}><MapIcon /> {t("eventPage.openLive")}</Link></Button>
        </div>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <div className="space-y-6">
          <Participation event={e} />
          {e.description ? (
            <Panel title={t("eventPage.about")}><p className="whitespace-pre-line text-body text-fg-secondary">{e.description}</p></Panel>
          ) : null}
          <Panel title={t("eventPage.launchSites")} bodyClassName="p-0">
            {sites.isLoading ? <div className="p-4"><Loading /></div> : sites.error ? <div className="p-4"><ErrorState error={sites.error} /></div> :
              (sites.data?.length ?? 0) === 0 ? <p className="p-4 text-footnote text-fg-muted">{t("eventPage.noSites")}</p> : (
                <ul className="divide-y divide-border">
                  {sites.data!.map((s) => (
                    <li key={s.id} className="flex items-start gap-3 px-4 py-3">
                      <Mountain className="mt-0.5 size-4 text-fg-muted" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{s.name}</span>
                          {!s.is_verified && <Badge variant="warning">{t("eventPage.siteUnverified")}</Badge>}
                        </div>
                        <div className="telemetry text-caption text-fg-muted">
                          {s.position ? fmtCoord(s.position.lat, s.position.lon) : t("eventPage.siteNoCoords")}
                          {s.elevation_m != null ? ` · ${s.elevation_m} m` : ""}
                        </div>
                        {s.notes && <p className="mt-1 text-footnote text-fg-secondary">{s.notes}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title={t("eventPage.details")}>
            <KeyValue
              items={[
                [t("eventPage.starts"), fmtDateTime(e.starts_at, locale)],
                [t("eventPage.ends"), fmtDateTime(e.ends_at, locale)],
                [t("eventPage.organizers"), e.organizers?.length ? e.organizers.map((o) => o.full_name).join(", ") : t("eventPage.noOrganizers")],
                [t("eventPage.members"), t("eventPage.membersValue", { p: e.counts?.pilots ?? 0, o: e.counts?.observers ?? 0, r: e.counts?.retrievers ?? 0 })],
                [t("eventPage.applications"), e.settings.applications_open ? t("eventPage.applicationsOpen") : t("eventPage.applicationsClosed")],
                [t("eventPage.liveMap"), !e.settings.live_tracking ? t("eventPage.liveOff") : e.settings.public_live_map ? t("eventPage.livePublic") : t("eventPage.liveMembers")],
                ...(e.center ? ([[t("eventPage.center"), `${fmtCoord(e.center.lat, e.center.lon)}${e.center_is_approximate ? ` (${t("eventPage.approx")})` : ""}`]] as [string, string][]) : []),
              ]}
            />
            {e.is_demo && <p className="mt-4 border-t border-border pt-3 text-caption text-fg-muted">{t("eventPage.demoNote")}</p>}
          </Panel>
          <WeatherPanel event={e} />
        </div>
      </div>
    </div>
  );
}

/* ---------------- membership / application ---------------- */

function useInvalidateEvent(slug: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["public", "event", slug] });
}

function Participation({ event: e }: { event: RfEvent }) {
  const { t } = useI18n();
  const { status, user } = useSession();
  const loc = useLocation();
  const access = eventAccess(e, user);
  const app = e.me?.application ?? null;
  const [reapply, setReapply] = useState(false);

  let body: React.ReactNode;
  if (status !== "authenticated") {
    body = e.settings.applications_open ? (
      <Button asChild size="lg" variant="outline">
        <Link to={`/login?next=${encodeURIComponent(loc.pathname)}`}>{t("apply.loginToApply")}</Link>
      </Button>
    ) : (
      <p className="text-footnote text-fg-secondary">{t("apply.closed")}</p>
    );
  } else if (access.isMember || access.admin) {
    body = <MemberPanel event={e} />;
  } else if (app?.status === "pending") {
    body = <PendingApplication event={e} />;
  } else if (!e.settings.applications_open) {
    body = (
      <div className="space-y-2">
        {app && <ApplicationStatusBadge status={app.status} />}
        <p className="text-footnote text-fg-secondary">{t("apply.closed")}</p>
      </div>
    );
  } else if (app && !reapply) {
    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ApplicationStatusBadge status={app.status} />
          <span className="text-footnote text-fg-secondary">{app.status === "rejected" ? t("apply.rejected") : t("apply.withdrawn")}</span>
        </div>
        <Button variant="outline" onClick={() => setReapply(true)}>{t("apply.again")}</Button>
      </div>
    );
  } else {
    body = <ApplyForm event={e} />;
  }

  return <Panel title={t("eventPage.participation")}>{body}</Panel>;
}

function ApplyForm({ event: e }: { event: RfEvent }) {
  const { t } = useI18n();
  const invalidate = useInvalidateEvent(e.slug);
  const [message, setMessage] = useState("");
  const apply = useMutation({
    // No role here: the organizer chooses pilot / observer / retriever when approving (api-contract).
    mutationFn: () => eventsApi.apply(e.id, message.trim()),
    onSuccess: () => invalidate(),
    // 409 (already pending) also means the server state changed: refresh so the pending panel shows.
    onError: () => invalidate(),
  });
  const icons = { pilot: Smartphone, observer: Monitor, retriever: Car } as const;

  function submit(ev: FormEvent) {
    ev.preventDefault();
    apply.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h3 className="text-headline font-semibold">{t("apply.title")}</h3>
        <p className="mt-1 text-footnote text-fg-secondary">{t("apply.lead")}</p>
      </div>
      <div>
        <p className="mb-2 text-footnote font-medium text-fg">{t("apply.rolesInfo")}</p>
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {MEMBER_ROLES.map((r) => {
            const Icon = icons[r];
            return (
              <li key={r} className="flex items-start gap-3 px-3 py-2.5">
                <Icon className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-footnote font-medium text-fg">{t(`role.${r}`)}</span>
                  <span className="block text-caption text-fg-secondary">{t(`apply.role.${r}`)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <Field id="apply-message" label={t("apply.message")} hint={t("apply.messageHint")}>
        <Textarea id="apply-message" value={message} onChange={(ev) => setMessage(ev.target.value)} rows={3} maxLength={1000} />
      </Field>
      <FormError error={apply.error} />
      <Button type="submit" size="lg" disabled={apply.isPending}>{apply.isPending ? t("common.wait") : t("apply.submit")}</Button>
    </form>
  );
}

function PendingApplication({ event: e }: { event: RfEvent }) {
  const { t } = useI18n();
  const invalidate = useInvalidateEvent(e.slug);
  const app = e.me!.application!;
  const [confirm, setConfirm] = useState(false);
  const withdraw = useMutation({
    mutationFn: () => eventsApi.withdraw(e.id, app.id),
    onSuccess: () => {
      setConfirm(false);
      void invalidate();
    },
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ApplicationStatusBadge status="pending" />
        <span className="text-footnote text-fg-secondary">{t("apply.pending")}</span>
      </div>
      <p className="text-footnote text-fg-secondary">{t("apply.pendingRoleNote")}</p>
      <Button variant="destructive" onClick={() => setConfirm(true)}>{t("apply.withdraw")}</Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("apply.withdrawTitle")}</DialogTitle>
            <DialogDescription>{t("apply.withdrawBody")}</DialogDescription>
          </DialogHeader>
          <FormError error={withdraw.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}>{t("apply.withdraw")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MemberPanel({ event: e }: { event: RfEvent }) {
  const { t } = useI18n();
  const { user } = useSession();
  const invalidate = useInvalidateEvent(e.slug);
  const access = eventAccess(e, user);
  const roles = myEventRoles(e);
  const [confirm, setConfirm] = useState(false);
  const leave = useMutation({
    mutationFn: () => eventsApi.leave(e.id),
    onSuccess: () => {
      setConfirm(false);
      void invalidate();
    },
  });
  const RetrieverIcon = ROLE_ICON.retriever;

  return (
    <div className="space-y-5">
      <div>
        <div className="text-footnote text-fg-secondary">{t("eventPage.yourRole")}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {roles.length ? roles.map((r) => <RoleBadge key={r} role={r} />) : <span className="text-footnote text-fg-muted">{t("eventPage.notMember")}</span>}
        </div>
      </div>

      {access.canOperate && (
        <div className="space-y-2">
          <Button asChild size="lg"><Link to={`/app/events/${e.id}/live`}><Monitor /> {t("eventPage.opsRoom")}</Link></Button>
          <p className="text-footnote text-fg-secondary">{t("eventPage.opsHint")}</p>
        </div>
      )}
      {access.isRetriever && (
        <div className="space-y-2">
          <Button asChild size="lg"><Link to={`/app/events/${e.id}/retrievals`}><RetrieverIcon /> {t("eventPage.myRetrievals")}</Link></Button>
          <p className="text-footnote text-fg-secondary">{t("eventPage.retrieverHint")}</p>
        </div>
      )}
      {access.role === "pilot" && (
        <div className="space-y-2 rounded-md border border-border p-4">
          <p className="flex items-start gap-2 text-body text-fg"><Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />{t("eventPage.pilotHint")}</p>
          <p className="text-footnote text-fg-secondary">
            {t("eventPage.pilotSharing")}{e.settings.pilots_see_each_other ? ` ${t("eventPage.pilotSharingOthers")}` : ""}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {access.canManage && (
          <Button asChild variant="outline"><Link to={`/app/events/${e.id}`}><Settings2 /> {t("eventPage.manage")}</Link></Button>
        )}
        {access.role && !access.organizer && (
          <Button variant="ghost" onClick={() => setConfirm(true)}>{t("eventPage.leave")}</Button>
        )}
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("eventPage.leaveTitle")}</DialogTitle>
            <DialogDescription>{t("eventPage.leaveBody", { name: e.name })}</DialogDescription>
          </DialogHeader>
          <FormError error={leave.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => leave.mutate()} disabled={leave.isPending}>{t("eventPage.leave")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
