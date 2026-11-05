import { useState } from "react";
import { Car, Crosshair, MessageSquarePlus, Phone, X, XCircle } from "lucide-react";
import type { Retrieval } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n";
import { fmtAccuracy, fmtAge, fmtCoord, fmtDistance, fmtTime } from "@/lib/format";
import { FormError } from "@/components/common";
import { RetrievalStatusBadge, SimBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/common";
import { isOpen, pilotPoint, retrieverDistanceM, secondsSince, telHref } from "./derive";
import type { CardContext } from "./RetrievalBoard";
import { useAgePhrase } from "./useAgePhrase";
import type { RetrievalActions } from "./useRetrievalAction";

export interface AssignCandidate {
  userId: string;
  fullName: string;
  onDuty: boolean | null;
  distanceM: number | null;
  active: number | null;
}

export function RetrievalDetail({
  r, ctx, canManage, actions, candidates, onCenter, onClose,
}: {
  r: Retrieval;
  ctx: CardContext;
  canManage: boolean;
  actions: RetrievalActions;
  candidates: AssignCandidate[];
  onCenter?: () => void;
  onClose: () => void;
}) {
  const { t, lang, locale } = useI18n();
  const phrase = useAgePhrase();
  const [assignee, setAssignee] = useState<string>("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const open = isOpen(r);
  const pp = pilotPoint(r);
  const ppAge = secondsSince(pp.t, ctx.nowMs, ctx.clockOffsetMs);
  const dist = retrieverDistanceM(r, ctx.retrievers);
  const rpT = r.retriever_position?.t ?? ctx.retrievers.find((x) => x.userId === r.retriever?.user_id)?.position?.t ?? null;
  const rpAge = secondsSince(rpT, ctx.nowMs, ctx.clockOffsetMs);
  const busy = actions.pending?.id === r.id ? actions.pending.kind : null;
  const conflict = actions.conflict?.id === r.id;

  return (
    <div className="flex flex-col" aria-label={t("rdetail.label", { name: r.pilot.full_name })}>
      <div className="flex items-start gap-2 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <div className="text-caption text-fg-muted">{t("rdetail.eyebrow")}</div>
          <div className="truncate text-headline font-semibold">{r.pilot.full_name}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <RetrievalStatusBadge status={r.status} />
            {r.is_simulated && <SimBadge />}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("live.deselect")}><X /></Button>
      </div>

      <div className="border-b border-border p-4">
        <div className="telemetry text-title3 text-fg">{phrase(r, ctx)}</div>
        <div className="mt-0.5 text-caption text-fg-muted tnum">{t("rdetail.requestedAt", { time: fmtTime(r.requested_at, locale) })}</div>
      </div>

      {conflict && (
        <p role="alert" className="border-b border-warning/40 bg-warning/10 px-4 py-2.5 text-footnote text-fg">{t("rdetail.conflict")}</p>
      )}

      <dl className="divide-y divide-border border-b border-border text-footnote">
        <Row label={t("rdetail.pilotPhone")}>
          {r.pilot.phone ? <a className="telemetry inline-flex items-center gap-1 text-fg underline decoration-fg/25 underline-offset-4 transition-colors hover:decoration-fg" href={telHref(r.pilot.phone)}><Phone className="size-3.5" aria-hidden />{r.pilot.phone}</a> : <span className="text-fg-muted">{t("rdetail.phoneHidden")}</span>}
        </Row>
        <Row label={pp.isPickup ? t("rdetail.pickup") : t("rdetail.pilotNow")}>
          <span className="telemetry select-all">{fmtCoord(pp.lat, pp.lon)}</span>
          <span className="block text-caption text-fg-muted tnum">
            {t("rdetail.positionAge", { age: fmtAge(ppAge, lang) })}
            {r.pilot_position?.h_acc_m != null ? ` · ${fmtAccuracy(r.pilot_position.h_acc_m, locale)}` : r.pickup.h_acc_m != null && pp.isPickup ? ` · ${fmtAccuracy(r.pickup.h_acc_m, locale)}` : ""}
          </span>
        </Row>
        {!pp.isPickup && (
          <Row label={t("rdetail.pickup")}>
            <span className="telemetry select-all">{fmtCoord(r.pickup.lat, r.pickup.lon)}</span>
          </Row>
        )}
        {r.note && <Row label={t("rdetail.note")}><span className="whitespace-pre-line">{r.note}</span></Row>}
        <Row label={t("rdetail.retriever")}>
          {r.retriever ? (
            <>
              <span className="inline-flex items-center gap-1.5 font-medium"><Car className="size-3.5 text-secondary" aria-hidden />{r.retriever.full_name}</span>
              {r.retriever.phone && <a className="telemetry ml-2 text-fg underline decoration-fg/25 underline-offset-4 transition-colors hover:decoration-fg" href={telHref(r.retriever.phone)}>{r.retriever.phone}</a>}
              <span className="block text-caption text-fg-muted tnum">
                {dist !== null ? t("retrieval.away", { d: fmtDistance(dist, locale) }) : t("rdetail.noRetrieverPos")}
                {rpAge !== null ? ` · ${t("rdetail.positionAge", { age: fmtAge(rpAge, lang) })}` : ""}
              </span>
            </>
          ) : <span className="text-fg-muted">{t("rdetail.unassigned")}</span>}
        </Row>
        {r.status === "delivered" && r.delivery_note && <Row label={t("rdetail.deliveryNote")}>{r.delivery_note}</Row>}
        {r.status === "cancelled" && (
          <Row label={t("rdetail.cancelledBy")}>{r.cancelled_by?.full_name ?? "—"}{r.cancel_reason ? ` — “${r.cancel_reason}”` : ""}</Row>
        )}
      </dl>

      <div className="space-y-3 p-4">
        {onCenter && <Button variant="outline" className="w-full" onClick={onCenter}><Crosshair /> {t("live.center")}</Button>}
        {canManage && open && (
          <>
            <div className="space-y-2">
              <div className="text-caption font-medium text-fg-secondary">{r.retriever ? t("rdetail.reassign") : t("rdetail.assign")}</div>
              <div className="flex gap-2">
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger className="h-10 min-w-0 flex-1" aria-label={t("rdetail.chooseRetriever")}>
                    <SelectValue placeholder={t("rdetail.chooseRetriever")} />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.length === 0 && <div className="px-2 py-2 text-footnote text-fg-muted">{t("rdetail.noRetrievers")}</div>}
                    {candidates.map((c) => (
                      <SelectItem key={c.userId} value={c.userId} disabled={c.userId === r.retriever?.user_id}>
                        {c.fullName}
                        {c.onDuty === true ? ` · ${t("rdetail.onDuty")}` : c.onDuty === false ? ` · ${t("rdetail.offDuty")}` : ""}
                        {c.distanceM !== null ? ` · ${fmtDistance(c.distanceM, locale)}` : ""}
                        {c.active ? ` · ${t("rdetail.activeN", { n: c.active })}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="h-10"
                  disabled={!assignee || busy !== null}
                  onClick={() => actions.run({ kind: "assign", id: r.id, retrieverUserId: assignee }, { onSuccess: () => setAssignee("") })}
                >
                  {busy === "assign" ? t("common.wait") : t("rdetail.assignBtn")}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("rdetail.notePlaceholder")} aria-label={t("rdetail.addNote")} />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" disabled={!note.trim() || busy !== null} onClick={() => actions.run({ kind: "note", id: r.id, text: note.trim() }, { onSuccess: () => setNote("") })}>
                  <MessageSquarePlus /> {t("rdetail.addNote")}
                </Button>
                <Button variant="destructive" disabled={busy !== null} onClick={() => setCancelOpen(true)}>
                  <XCircle /> {t("rdetail.cancel")}
                </Button>
              </div>
            </div>
          </>
        )}
        {!canManage && <p className="text-caption text-fg-muted">{t("rdetail.readOnly")}</p>}
        {actions.error && actions.pending === null && <FormError error={actions.error} />}
      </div>

      {r.updates && r.updates.length > 0 && (
        <div className="border-t border-border p-4">
          <h3 className="mb-2 text-caption font-semibold tracking-wide text-fg-secondary uppercase">{t("rdetail.timeline")}</h3>
          <ol className="space-y-2">
            {[...r.updates].reverse().map((u) => (
              <li key={u.id} className="flex gap-3 text-footnote">
                <span className="telemetry w-12 shrink-0 text-caption text-fg-muted">{fmtTime(u.created_at, locale, false)}</span>
                <span className="min-w-0">
                  <span className="font-medium">{t(`rupdate.${u.kind}`)}</span>
                  {u.actor && <span className="text-fg-secondary"> · {u.actor.full_name}</span>}
                  {u.body && <span className="block text-fg-secondary">{u.body}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("rdetail.cancelTitle", { name: r.pilot.full_name })}</DialogTitle>
            <DialogDescription>{t("rdetail.cancelBody")}</DialogDescription>
          </DialogHeader>
          <Field id={`cancel-${r.id}`} label={t("rdetail.cancelReason")}>
            <Textarea id={`cancel-${r.id}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("rdetail.cancelPlaceholder")} />
          </Field>
          {conflict && <p role="alert" className="text-footnote text-warning">{t("rdetail.conflict")}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>{t("common.cancel")}</Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => actions.run({ kind: "cancel", id: r.id, text: reason.trim() }, { onSuccess: () => { setCancelOpen(false); setReason(""); } })}
            >
              {t("rdetail.cancelConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 px-4 py-2.5">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

