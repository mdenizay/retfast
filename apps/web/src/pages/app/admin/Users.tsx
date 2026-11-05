import { useDeferredValue, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, KeyRound, MailWarning, Search, ShieldCheck, UserCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminApi } from "@/lib/api/endpoints";
import { isPlatformAdminUser, type AdminUser } from "@/lib/api/types";
import { useSession } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { EmptyState, ErrorState, FormError, Loading, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Pending =
  | { kind: "admin"; user: AdminUser; value: boolean }
  | { kind: "disabled"; user: AdminUser; value: boolean };

export default function AdminUsersPage() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim());
  const users = useQuery({ queryKey: ["admin", "users", dq], queryFn: () => adminApi.users(dq || undefined) });
  const [pending, setPending] = useState<Pending | null>(null);
  const items = users.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("admin.usersTitle")} subtitle={t("admin.usersLead")} />
      <div className="relative sm:w-96">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("admin.searchUsers")} aria-label={t("admin.searchUsers")} className="pl-9" />
      </div>
      {users.isLoading ? <Loading /> : users.error ? <ErrorState error={users.error} onRetry={() => void users.refetch()} /> : items.length === 0 ? (
        <EmptyState title={t("admin.noUsers")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-footnote">
            <thead className="text-left text-caption text-fg-muted">
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 font-medium">{t("admin.user")}</th>
                <th className="px-4 py-2.5 font-medium">{t("admin.state")}</th>
                <th className="px-4 py-2.5 font-medium">{t("admin.platformAdmin")}</th>
                <th className="px-4 py-2.5 font-medium">{t("admin.created")}</th>
                <th className="px-4 py-2.5"><span className="sr-only">{t("common.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => <UserRow key={u.id} user={u} onRequest={setPending} />)}
            </tbody>
          </table>
        </div>
      )}
      {pending && <ConfirmDialog pending={pending} onClose={() => setPending(null)} />}
    </div>
  );
}

function UserRow({ user: u, onRequest }: { user: AdminUser; onRequest: (p: Pending) => void }) {
  const { t, locale } = useI18n();
  const { user: me } = useSession();
  const self = me?.id === u.id;
  const admin = isPlatformAdminUser(u);
  const reset = useMutation({ mutationFn: () => adminApi.resetPassword(u.id) });
  return (
    <tr className="border-b border-border align-middle last:border-0" data-user={u.email}>
      <td className="px-4 py-3">
        <div className="font-medium">
          {u.full_name}
          {self && <span className="ml-1.5 text-caption font-normal text-fg-muted">({t("admin.you")})</span>}
        </div>
        <div className="text-caption text-fg-muted">{u.email}</div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {u.disabled
            ? <Badge variant="error"><Ban aria-hidden />{t("admin.disabled")}</Badge>
            : <Badge variant="success"><CheckCircle2 aria-hidden />{t("admin.active")}</Badge>}
          {u.must_change_password && <Badge variant="warning"><KeyRound aria-hidden />{t("admin.mustChange")}</Badge>}
          {!u.email_verified && <Badge variant="muted"><MailWarning aria-hidden />{t("admin.unverified")}</Badge>}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={admin}
            disabled={self}
            aria-label={t("admin.adminFor", { name: u.full_name })}
            title={self ? t("admin.selfLocked") : undefined}
            onCheckedChange={(c) => onRequest({ kind: "admin", user: u, value: c })}
          />
          {admin && <ShieldCheck className="size-4 text-primary" aria-hidden />}
          <span className="text-caption text-fg-secondary">{admin ? t("admin.platformAdmin") : "—"}</span>
        </div>
      </td>
      <td className="px-4 py-3 tnum">{fmtDate(u.created_at, locale)}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {reset.isSuccess ? (
            <span role="status" className="text-caption text-success">{t("admin.resetSent")}</span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => reset.mutate()} disabled={reset.isPending}>
              <KeyRound /> {t("admin.sendReset")}
            </Button>
          )}
          {!self && (
            u.disabled ? (
              <Button size="sm" variant="outline" onClick={() => onRequest({ kind: "disabled", user: u, value: false })}>
                <UserCheck /> {t("admin.enable")}
              </Button>
            ) : (
              <Button size="sm" variant="destructive" onClick={() => onRequest({ kind: "disabled", user: u, value: true })}>
                <Ban /> {t("admin.disable")}
              </Button>
            )
          )}
        </div>
        {reset.error != null && <div className="mt-2"><FormError error={reset.error} /></div>}
      </td>
    </tr>
  );
}

function ConfirmDialog({ pending, onClose }: { pending: Pending; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const u = pending.user;
  const save = useMutation({
    mutationFn: () =>
      adminApi.updateUser(u.id, pending.kind === "admin" ? { is_platform_admin: pending.value } : { disabled: pending.value }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      onClose();
    },
  });
  const name = u.full_name || u.email;
  const copy =
    pending.kind === "admin"
      ? pending.value
        ? { title: t("admin.confirmGrantTitle"), body: t("admin.confirmGrantBody", { name }), cta: t("admin.grant"), danger: false }
        : { title: t("admin.confirmRevokeTitle"), body: t("admin.confirmRevokeBody", { name }), cta: t("admin.revoke"), danger: true }
      : pending.value
        ? { title: t("admin.confirmDisableTitle"), body: t("admin.confirmDisableBody", { name }), cta: t("admin.disable"), danger: true }
        : { title: t("admin.confirmEnableTitle"), body: t("admin.confirmEnableBody", { name }), cta: t("admin.enable"), danger: false };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
        </DialogHeader>
        <FormError error={save.error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant={copy.danger ? "destructive" : "default"} onClick={() => save.mutate()} disabled={save.isPending}>{copy.cta}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
