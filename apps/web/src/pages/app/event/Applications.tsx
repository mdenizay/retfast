import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Inbox, MessageSquareText, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { eventsApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/client";
import type { Application, ApplicationStatus, MemberRole } from "@/lib/api/types";
import { fmtAge, fmtDateTime } from "@/lib/format";
import { useNow } from "@/hooks/useNow";
import { EmptyState, ErrorState, Field, FormError, Loading } from "@/components/common";
import { ApplicationStatusBadge, RoleBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RoleChooser } from "@/features/events/RoleChooser";
import { useEventContext } from "@/features/events/context";
import { cn } from "@/lib/utils";

type Filter = "pending" | "approved" | "rejected" | "all";

export default function ApplicationsPage() {
  const { t } = useI18n();
  const { event, refetch: refetchEvent } = useEventContext();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("pending");
  const [notice, setNotice] = useState<string | null>(null);
  const key = ["app", "applications", event.id];
  // One request for everything keeps counts per tab honest without extra round-trips.
  const apps = useQuery({ queryKey: key, queryFn: () => eventsApi.applications(event.id), refetchInterval: 30_000 });

  const all = apps.data ?? [];
  const count = (s: ApplicationStatus) => all.filter((a) => a.status === s).length;
  const shown = (filter === "all" ? all : all.filter((a) => a.status === filter)).sort((a, b) =>
    filter === "pending" ? Date.parse(a.created_at) - Date.parse(b.created_at) : Date.parse(b.decided_at ?? b.created_at) - Date.parse(a.decided_at ?? a.created_at),
  );

  const onDecided = (msg: string) => {
    setNotice(msg);
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["app", "members", event.id] });
    void qc.invalidateQueries({ queryKey: ["app", "events", "mine"] });
    refetchEvent();
  };

  const filters: { id: Filter; label: string; n?: number }[] = [
    { id: "pending", label: t("apps.f.pending"), n: count("pending") },
    { id: "approved", label: t("apps.f.approved"), n: count("approved") },
    { id: "rejected", label: t("apps.f.rejected"), n: count("rejected") },
    { id: "all", label: t("apps.f.all"), n: all.length },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-footnote text-fg-secondary">{t("apps.lead")}</p>
        <div className="flex gap-1.5" role="group" aria-label={t("apps.filterLabel")}>
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-sm border px-3 text-footnote font-medium tnum",
                filter === f.id ? "border-fg bg-fg text-background" : "border-border text-fg-secondary hover:bg-accent",
              )}
            >
              {f.label}
              {apps.data && <span className="opacity-70">{f.n}</span>}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div role="status" className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-footnote text-fg">
          <Check className="size-4 text-success" aria-hidden />
          <span className="flex-1">{notice}</span>
          <button type="button" className="text-fg-muted hover:text-fg" onClick={() => setNotice(null)} aria-label={t("common.close")}><X className="size-4" /></button>
        </div>
      )}

      {apps.isLoading ? <Loading /> : apps.error ? <ErrorState error={apps.error} onRetry={() => void apps.refetch()} /> :
        shown.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-6" />}
            title={filter === "pending" ? t("apps.emptyPending") : t("apps.empty")}
            body={filter === "pending" && !event.settings.applications_open ? t("apps.closedHint") : undefined}
          />
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border bg-surface">
            {shown.map((a) =>
              a.status === "pending" ? (
                <PendingRow key={a.id} app={a} onDecided={onDecided} onConflict={() => void apps.refetch()} />
              ) : (
                <DecidedRow key={a.id} app={a} />
              ),
            )}
          </ul>
        )}
    </div>
  );
}

function Applicant({ app }: { app: Application }) {
  const { t, lang, locale } = useI18n();
  const now = useNow(30_000);
  const age = (now - Date.parse(app.created_at)) / 1000;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-headline font-semibold">{app.user.full_name}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-footnote text-fg-secondary">
        <span className="truncate">{app.user.email}</span>
        <span className="telemetry text-fg-muted" title={fmtDateTime(app.created_at, locale)}>{t("apps.ago", { age: fmtAge(age, lang) })}</span>
      </div>
      {app.message && (
        <p className="mt-2 flex gap-2 border-l-2 border-border pl-3 text-footnote text-fg">
          <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-fg-muted" aria-hidden />
          <span className="whitespace-pre-line">{app.message}</span>
        </p>
      )}
    </div>
  );
}

function PendingRow({ app, onDecided, onConflict }: { app: Application; onDecided: (msg: string) => void; onConflict: () => void }) {
  const { t } = useI18n();
  const { event } = useEventContext();
  const [role, setRole] = useState<MemberRole | null>(null);
  const [note, setNote] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const conflictHandler = (e: unknown) => {
    if (isApiError(e) && e.status === 409) onConflict();
  };
  const approve = useMutation({
    mutationFn: (r: MemberRole) => eventsApi.approve(event.id, app.id, r, note.trim()),
    onSuccess: (_d, r) => onDecided(t("apps.approvedAs", { name: app.user.full_name, role: t(`role.${r}`) })),
    onError: conflictHandler,
  });
  const reject = useMutation({
    mutationFn: () => eventsApi.reject(event.id, app.id, rejectNote.trim()),
    onSuccess: () => {
      setRejectOpen(false);
      onDecided(t("apps.rejectedName", { name: app.user.full_name }));
    },
    onError: conflictHandler,
  });
  const busy = approve.isPending || reject.isPending;
  const err = approve.error ?? (rejectOpen ? null : reject.error);

  return (
    <li className="border-b border-border p-4 last:border-b-0 sm:p-5" aria-label={app.user.full_name}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <Applicant app={app} />
        <div className="flex shrink-0 flex-col gap-3 xl:w-[26rem]">
          <div>
            <div className="mb-1.5 text-caption text-fg-muted">{t("apps.grantRole")}</div>
            <RoleChooser name={`role-${app.id}`} value={role} onChange={setRole} required label={t("apps.grantRoleFor", { name: app.user.full_name })} size="sm" disabled={busy} />
          </div>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("apps.notePlaceholder")}
            aria-label={t("apps.noteLabel")}
            className="h-10"
            disabled={busy}
          />
          <div className="flex gap-2">
            <Button onClick={() => role && approve.mutate(role)} disabled={busy || !role} className="flex-1">
              <Check /> {role ? t("apps.approveAs", { role: t(`role.${role}`) }) : t("apps.chooseRoleFirst")}
            </Button>
            <Button variant="destructive" onClick={() => setRejectOpen(true)} disabled={busy}>
              <X /> {t("apps.reject")}
            </Button>
          </div>
          {err ? (isApiError(err) && err.status === 409 ? <p role="alert" className="text-footnote text-warning">{t("apps.conflict")}</p> : <FormError error={err} />) : null}
        </div>
      </div>
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("apps.rejectTitle", { name: app.user.full_name })}</DialogTitle>
            <DialogDescription>{t("apps.rejectBody")}</DialogDescription>
          </DialogHeader>
          <Field id={`rej-${app.id}`} label={t("apps.rejectNote")}>
            <Textarea id={`rej-${app.id}`} rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
          </Field>
          {reject.error ? (isApiError(reject.error) && reject.error.status === 409 ? <p role="alert" className="text-footnote text-warning">{t("apps.conflict")}</p> : <FormError error={reject.error} />) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => reject.mutate()} disabled={reject.isPending}>{t("apps.rejectConfirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function DecidedRow({ app }: { app: Application }) {
  const { t, locale } = useI18n();
  return (
    <li className="flex flex-col gap-3 border-b border-border p-4 last:border-b-0 sm:flex-row sm:items-start sm:p-5">
      <Applicant app={app} />
      <div className="shrink-0 space-y-1 text-footnote sm:w-72 sm:text-right">
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          <ApplicationStatusBadge status={app.status} />
          {app.granted_role && <RoleBadge role={app.granted_role} />}
        </div>
        {app.decided_by && (
          <div className="text-caption text-fg-muted">{t("apps.decidedBy", { name: app.decided_by.full_name, time: fmtDateTime(app.decided_at, locale) })}</div>
        )}
        {app.decision_note && <div className="text-caption text-fg-secondary">“{app.decision_note}”</div>}
      </div>
    </li>
  );
}
