import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Car, CheckCircle2, Hand, LocateFixed, LocateOff, MapPin, MessageSquareText, Phone, Undo2, UserCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/auth";
import { retrievalsApi } from "@/lib/api/endpoints";
import type { Retrieval } from "@/lib/api/types";
import { fmtAccuracy, fmtAge, fmtCoord, fmtDistance, fmtTime } from "@/lib/format";
import { EmptyState, ErrorState, Field, FormError, Loading } from "@/components/common";
import { ConnectionIndicator, RetrievalStatusBadge, SimBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapCanvas } from "@/components/map/MapCanvas";
import { useEventContext } from "@/features/events/context";
import { useLiveEvent } from "@/features/live/useLiveEvent";
import { useRetrievalAction, type RetrievalActions } from "@/features/live/useRetrievalAction";
import { LiveMapLayers, type MapSelection } from "@/features/live/LiveMapLayers";
import { distanceM, pilotPoint, secondsSince, statusSince, telHref, visibleRetrievals } from "@/features/live/derive";
import type { RetrieverView } from "@/features/live/store";
import { cn } from "@/lib/utils";

const POST_EVERY_MS = 15_000;

interface MyPos { lat: number; lon: number; acc: number; t: number; course: number | null; speed: number | null }

export default function MyRetrievalsPage() {
  const { t, lang, locale } = useI18n();
  const { user } = useSession();
  const { event } = useEventContext();
  const live = useLiveEvent(event.id, { pilots: false, retrievals: true });
  const actions = useRetrievalAction(live.store);
  const share = useShareLocation(event.id);
  const [selection, setSelection] = useState<MapSelection>(null);
  const [center, setCenter] = useState<{ n: number; p: { lat: number; lon: number } | null }>({ n: 0, p: null });

  const mine = useMemo(() => visibleRetrievals(live.retrievals, { kind: "retriever", userId: user?.id ?? "" }), [live.retrievals, user?.id]);
  const active = mine.filter((r) => r.retriever?.user_id === user?.id && (r.status === "accepted" || r.status === "picked_up"))
    .sort((a, b) => Date.parse(a.requested_at) - Date.parse(b.requested_at));
  const open = mine.filter((r) => r.status === "requested").sort((a, b) => Date.parse(a.requested_at) - Date.parse(b.requested_at));
  const ctxNow = { nowMs: live.now, clockOffsetMs: live.state.clockOffsetMs };

  const me: RetrieverView[] = share.pos
    ? [{
        userId: user?.id ?? "me", fullName: t("myret.you"), onDuty: true, activeRetrievals: active.length,
        position: { lat: share.pos.lat, lon: share.pos.lon, h_acc_m: share.pos.acc, t: new Date(share.pos.t).toISOString(), course_deg: share.pos.course, speed_ms: share.pos.speed },
        receivedAtMs: share.pos.t, ageS: (live.now - share.pos.t) / 1000, freshness: live.now - share.pos.t < 30_000 ? "live" : live.now - share.pos.t < 300_000 ? "stale" : "lost",
      }]
    : [];
  const distFromMe = (r: Retrieval) => (share.pos ? distanceM(share.pos, pilotPoint(r)) : null);
  const focus = (r: Retrieval) => {
    setSelection({ kind: "retrieval", id: r.id });
    setCenter((c) => ({ n: c.n + 1, p: pilotPoint(r) }));
  };
  const lostRace = actions.conflict?.kind === "accept";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="text-headline font-semibold">{t("myret.title")}</h2>
          <p className="text-footnote text-fg-secondary">{t("myret.lead")}</p>
        </div>
        <DutyToggle eventId={event.id} />
        <ShareToggle share={share} />
        <ConnectionIndicator status={live.connection} attempt={live.reconnectAttempt} />
      </div>

      {lostRace && (
        <p role="alert" className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-footnote text-fg">{t("myret.lostRace")}</p>
      )}
      {actions.error && <FormError error={actions.error} />}
      {live.snapshotError != null && <ErrorState error={live.snapshotError} onRetry={() => void live.refetch()} />}

      <div className="grid gap-5 lg:grid-cols-[1fr_26rem]">
        <div className="h-[46dvh] min-h-80 overflow-hidden rounded-lg border border-border lg:sticky lg:top-6 lg:h-[calc(100dvh-14rem)]">
          <MapCanvas label={t("myret.mapLabel")} initialCenter={event.center ? [event.center.lon, event.center.lat] : undefined} initialZoom={event.center ? 11 : 5}>
            {(ready) => (
              <LiveMapLayers
                {...ready}
                pilots={[]}
                retrievals={mine}
                retrievers={me}
                selection={selection}
                follow={false}
                centerRequest={center.n}
                centerOn={center.p}
                fallbackCenter={event.center}
                nowMs={live.now}
                clockOffsetMs={live.state.clockOffsetMs}
                onSelect={(s) => {
                  setSelection(s);
                  if (s?.kind === "retrieval") document.querySelector(`[data-card="${s.id}"]`)?.scrollIntoView({ block: "nearest" });
                }}
              />
            )}
          </MapCanvas>
        </div>

        <div className="space-y-6">
          <section aria-labelledby="mine-h">
            <h3 id="mine-h" className="mb-2 flex items-center gap-2 text-footnote font-semibold tracking-wide text-fg-secondary uppercase">
              <Car className="size-4 text-secondary" aria-hidden />{t("myret.active")} <span className="tnum text-fg-muted">{active.length}</span>
            </h3>
            {active.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-4 text-footnote text-fg-muted">{t("myret.noActive")}</p>
            ) : (
              <ul className="space-y-3">
                {active.map((r) => (
                  <ActiveCard key={r.id} r={r} actions={actions} dist={distFromMe(r)} ctx={ctxNow} selected={selection?.kind === "retrieval" && selection.id === r.id} onFocus={() => focus(r)} />
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="open-h">
            <h3 id="open-h" className="mb-2 flex items-center gap-2 text-footnote font-semibold tracking-wide text-fg-secondary uppercase">
              <MapPin className="size-4 text-retrieval" aria-hidden />{t("myret.open")} <span className="tnum text-fg-muted">{open.length}</span>
            </h3>
            {live.isLoading ? <Loading /> : open.length === 0 ? (
              <EmptyState icon={<CheckCircle2 className="size-6" />} title={t("myret.noOpen")} body={t("myret.noOpenBody")} />
            ) : (
              <ul className="space-y-2" aria-label={t("myret.open")}>
                {open.map((r) => {
                  const wait = secondsSince(statusSince(r), ctxNow.nowMs, ctxNow.clockOffsetMs);
                  const d = distFromMe(r);
                  const busy = actions.pending?.id === r.id;
                  return (
                    <li key={r.id} data-card={r.id} className={cn("rounded-md border bg-surface p-3", selection?.kind === "retrieval" && selection.id === r.id ? "border-fg" : "border-border")}>
                      <div className="flex items-start gap-3">
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => focus(r)}>
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium">{r.pilot.full_name}</span>
                            {r.is_simulated && <SimBadge className="py-0" />}
                          </div>
                          <div className="text-footnote text-retrieval tnum">{t("retrieval.age.requested", { age: fmtAge(wait, lang) })}</div>
                          <div className="telemetry text-caption text-fg-muted">
                            {fmtCoord(r.pickup.lat, r.pickup.lon)}{d !== null ? ` · ${t("myret.fromYou", { d: fmtDistance(d, locale) })}` : ""}
                          </div>
                          {r.note && <div className="mt-1 flex gap-1.5 text-caption text-fg-secondary"><MessageSquareText className="mt-0.5 size-3 shrink-0" aria-hidden />{r.note}</div>}
                        </button>
                        <Button onClick={() => actions.run({ kind: "accept", id: r.id })} disabled={busy}>
                          <Hand /> {busy ? t("common.wait") : t("myret.accept")}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <p className="text-caption text-fg-muted">{t("myret.phoneNote")}</p>
        </div>
      </div>
    </div>
  );
}

function ActiveCard({
  r, actions, dist, ctx, selected, onFocus,
}: {
  r: Retrieval;
  actions: RetrievalActions;
  dist: number | null;
  ctx: { nowMs: number; clockOffsetMs: number };
  selected: boolean;
  onFocus: () => void;
}) {
  const { t, lang, locale } = useI18n();
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [note, setNote] = useState("");
  const pp = pilotPoint(r);
  const ppAge = secondsSince(pp.t, ctx.nowMs, ctx.clockOffsetMs);
  const since = secondsSince(statusSince(r), ctx.nowMs, ctx.clockOffsetMs);
  const busy = actions.pending?.id === r.id ? actions.pending.kind : null;
  return (
    <li data-card={r.id} className={cn("rounded-lg border bg-surface", selected ? "border-fg" : "border-border")}>
      <button type="button" onClick={onFocus} className="block w-full p-4 text-left">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-headline font-semibold">{r.pilot.full_name}</span>
          {r.is_simulated && <SimBadge />}
          <RetrievalStatusBadge status={r.status} />
        </div>
        <div className="mt-1 text-footnote text-fg-secondary tnum">{t(`retrieval.age.${r.status as "accepted" | "picked_up"}`, { age: fmtAge(since, lang) })}</div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-footnote">
          <div>
            <dt className="text-caption text-fg-muted">{pp.isPickup ? t("rdetail.pickup") : t("rdetail.pilotNow")}</dt>
            <dd className="telemetry">{fmtCoord(pp.lat, pp.lon)}</dd>
          </div>
          <div>
            <dt className="text-caption text-fg-muted">{t("myret.positionAge")}</dt>
            <dd className={cn("telemetry", ppAge !== null && ppAge > 300 ? "text-offline" : ppAge !== null && ppAge > 30 ? "text-stale" : "")}>
              {fmtAge(ppAge, lang)}{r.pilot_position?.h_acc_m != null ? ` · ${fmtAccuracy(r.pilot_position.h_acc_m, locale)}` : ""}
            </dd>
          </div>
          {dist !== null && (
            <div>
              <dt className="text-caption text-fg-muted">{t("myret.distance")}</dt>
              <dd className="telemetry">{fmtDistance(dist, locale)}</dd>
            </div>
          )}
        </dl>
        {r.note && <p className="mt-2 flex gap-1.5 text-footnote text-fg-secondary"><MessageSquareText className="mt-0.5 size-3.5 shrink-0" aria-hidden />{r.note}</p>}
      </button>
      <div className="flex flex-wrap gap-2 border-t border-border p-3">
        {r.pilot.phone ? (
          <Button asChild variant="outline"><a href={telHref(r.pilot.phone)}><Phone /> {t("myret.call")} <span className="telemetry text-footnote">{r.pilot.phone}</span></a></Button>
        ) : <span className="self-center text-caption text-fg-muted">{t("rdetail.phoneHidden")}</span>}
        <a className="self-center text-footnote text-primary hover:underline" href={`https://www.google.com/maps/dir/?api=1&destination=${pp.lat},${pp.lon}`} target="_blank" rel="noreferrer">{t("myret.directions")}</a>
        <div className="ml-auto flex gap-2">
          {r.status === "accepted" && (
            <>
              <Button variant="ghost" onClick={() => setReleaseOpen(true)} disabled={busy !== null}><Undo2 /> {t("myret.release")}</Button>
              <Button onClick={() => actions.run({ kind: "picked_up", id: r.id })} disabled={busy !== null}>
                <UserCheck /> {busy === "picked_up" ? t("common.wait") : t("myret.pickedUp")}
              </Button>
            </>
          )}
          {r.status === "picked_up" && (
            <Button onClick={() => setDeliverOpen(true)} disabled={busy !== null}><CheckCircle2 /> {t("myret.delivered")}</Button>
          )}
        </div>
      </div>
      <Dialog open={deliverOpen} onOpenChange={setDeliverOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("myret.deliverTitle", { name: r.pilot.full_name })}</DialogTitle>
            <DialogDescription>{t("myret.deliverBody")}</DialogDescription>
          </DialogHeader>
          <Field id={`dn-${r.id}`} label={t("myret.deliverNote")}>
            <Textarea id={`dn-${r.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("myret.deliverPlaceholder")} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliverOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={() => actions.run({ kind: "delivered", id: r.id, text: note.trim() }, { onSuccess: () => setDeliverOpen(false) })} disabled={busy !== null}>
              {t("myret.deliverConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("myret.releaseTitle")}</DialogTitle>
            <DialogDescription>{t("myret.releaseBody", { name: r.pilot.full_name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleaseOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => actions.run({ kind: "release", id: r.id }, { onSuccess: () => setReleaseOpen(false) })} disabled={busy !== null}>
              {t("myret.release")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/** PUT /retrievers/me/duty. The API has no GET for duty, so the state shown is the last one this page set. */
function DutyToggle({ eventId }: { eventId: string }) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<{ on: boolean; at: number } | null>(null);
  const m = useMutation({
    mutationFn: (on: boolean) => retrievalsApi.setDuty(eventId, on).then(() => on),
    onSuccess: (on) => setState({ on, at: Date.now() }),
  });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex overflow-hidden rounded-sm border border-border" role="group" aria-label={t("myret.duty")}>
        {[true, false].map((on) => (
          <button
            key={String(on)}
            type="button"
            aria-pressed={state?.on === on}
            disabled={m.isPending}
            onClick={() => m.mutate(on)}
            className={cn("h-10 px-3 text-footnote font-medium", state?.on === on ? "bg-fg text-background" : "bg-surface text-fg-secondary hover:bg-accent")}
          >
            {on ? t("myret.onDuty") : t("myret.offDuty")}
          </button>
        ))}
      </div>
      <span className="text-caption text-fg-muted">
        {m.error ? t("myret.dutyFailed") : state ? t("myret.dutySet", { time: fmtTime(state.at, locale, false) }) : t("myret.dutyUnknown")}
      </span>
    </div>
  );
}

function useShareLocation(eventId: string) {
  const [on, setOn] = useState(false);
  const [pos, setPos] = useState<MyPos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<number | null>(null);
  const lastPost = useRef(0);
  const supported = typeof navigator !== "undefined" && "geolocation" in navigator;
  useEffect(() => {
    if (!on || !supported) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const next: MyPos = {
          lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: p.timestamp || Date.now(),
          course: Number.isFinite(p.coords.heading ?? NaN) ? p.coords.heading : null, speed: Number.isFinite(p.coords.speed ?? NaN) ? p.coords.speed : null,
        };
        setPos(next);
        setError(null);
        if (Date.now() - lastPost.current >= POST_EVERY_MS) {
          lastPost.current = Date.now();
          retrievalsApi
            .postMyPosition(eventId, { lat: next.lat, lon: next.lon, h_acc_m: next.acc, t: new Date(next.t).toISOString(), course_deg: next.course, speed_ms: next.speed })
            .then(() => setLastSent(Date.now()))
            .catch(() => setError("post"));
        }
      },
      (e) => setError(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [on, eventId, supported]);
  return { on, setOn, pos: on ? pos : null, error: on && !supported ? "unsupported" : error, lastSent };
}

function ShareToggle({ share }: { share: ReturnType<typeof useShareLocation> }) {
  const { t, locale } = useI18n();
  return (
    <div className="flex flex-col gap-1">
      <Button variant={share.on ? "default" : "outline"} aria-pressed={share.on} onClick={() => share.setOn(!share.on)} className="h-10">
        {share.on ? <LocateFixed /> : <LocateOff />} {share.on ? t("myret.sharingOn") : t("myret.sharingOff")}
      </Button>
      <span className="max-w-60 text-caption text-fg-muted">
        {share.error ? t(`myret.geo.${share.error as "denied" | "unavailable" | "unsupported" | "post"}`)
          : share.on && share.lastSent ? t("myret.lastSent", { time: fmtTime(share.lastSent, locale) })
          : t("myret.shareHint")}
      </span>
    </div>
  );
}
