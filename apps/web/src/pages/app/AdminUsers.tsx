import { useDeferredValue, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Search, Shield } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminApi } from "@/lib/api/endpoints";
import type { AdminUser, GlobalRole } from "@/lib/api/types";
import { useSession } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { EmptyState, ErrorState, FormError, Loading, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ALL_ROLES: GlobalRole[] = ["pilot", "observer", "event_organizer", "rescue_operator", "platform_admin"];

export default function AdminUsersPage() {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim());
  const users = useQuery({ queryKey: ["admin", "users", dq], queryFn: () => adminApi.users(dq || undefined) });
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const items = users.data?.items ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title={t("nav.adminUsers")} subtitle={t("admin.usersLead")} />
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
                <th className="px-4 py-2.5 font-medium">{t("common.name")}</th>
                <th className="px-4 py-2.5 font-medium">{t("admin.roles")}</th>
                <th className="px-4 py-2.5 font-medium">{t("admin.state")}</th>
                <th className="px-4 py-2.5 font-medium">{t("admin.created")}</th>
                <th className="px-4 py-2.5"><span className="sr-only">{t("common.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3"><div className="font-medium">{u.full_name}</div><div className="text-caption text-fg-muted">{u.email}</div></td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} variant={r === "platform_admin" ? "primary" : "muted"}>{t(`role.global.${r}`)}</Badge>)}</div></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.disabled ? <Badge variant="error">{t("admin.disabled")}</Badge> : <Badge variant="success">{t("admin.active")}</Badge>}
                      {u.must_change_password && <Badge variant="warning">{t("admin.mustChange")}</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 tnum">{fmtDate(u.created_at, locale)}</td>
                  <td className="px-4 py-3 text-right"><Button size="sm" variant="outline" onClick={() => setEditing(u)}><Shield /> {t("common.edit")}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <EditUserDialog user={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditUserDialog({ user: u, onClose }: { user: AdminUser; onClose: () => void }) {
  const { t } = useI18n();
  const { user: me } = useSession();
  const qc = useQueryClient();
  const [roles, setRoles] = useState<GlobalRole[]>(u.roles);
  const [disabled, setDisabled] = useState(Boolean(u.disabled));
  const save = useMutation({
    mutationFn: () => adminApi.updateUser(u.id, { roles, disabled }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin", "users"] }); onClose(); },
  });
  const reset = useMutation({ mutationFn: () => adminApi.resetPassword(u.id) });
  const self = me?.id === u.id;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{u.full_name}</DialogTitle>
          <DialogDescription>{u.email}</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2.5">
          <legend className="mb-2 text-footnote font-semibold">{t("admin.roles")}</legend>
          {ALL_ROLES.map((r) => (
            <div key={r} className="flex items-center gap-2">
              <Checkbox id={`role-${r}`} checked={roles.includes(r)} disabled={self && r === "platform_admin"}
                onCheckedChange={(c) => setRoles((cur) => (c === true ? [...new Set([...cur, r])] : cur.filter((x) => x !== r)))} />
              <Label htmlFor={`role-${r}`} className="text-body text-fg">{t(`role.global.${r}`)}</Label>
            </div>
          ))}
        </fieldset>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <Label htmlFor="u-disabled" className="text-body text-fg">{t("admin.disableAccount")}</Label>
          <Switch id="u-disabled" checked={disabled} disabled={self} onCheckedChange={setDisabled} />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-caption text-fg-muted">{reset.isSuccess ? t("admin.resetSent") : t("admin.resetHint")}</p>
          <Button size="sm" variant="outline" onClick={() => reset.mutate()} disabled={reset.isPending || reset.isSuccess}><KeyRound /> {t("admin.sendReset")}</Button>
        </div>
        <FormError error={save.error ?? reset.error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
