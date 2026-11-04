import { useDeferredValue, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Search, UserMinus, UserPlus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { eventsApi, pilotsApi } from "@/lib/api/endpoints";
import type { EventRole } from "@/lib/api/types";
import { hasRole, useSession } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { EmptyState, ErrorState, FormError, Loading, PageHeader, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ROLES: EventRole[] = ["participant", "observer", "organizer"];

export default function ParticipantsPage() {
  const { id = "" } = useParams();
  const { t, locale } = useI18n();
  const { user } = useSession();
  const qc = useQueryClient();
  const event = useQuery({ queryKey: ["app", "event", id], queryFn: () => eventsApi.get(id) });
  const key = ["app", "participants", id];
  const parts = useQuery({ queryKey: key, queryFn: () => eventsApi.participants(id) });
  const canManage = event.data?.my_role === "organizer" || hasRole(user, "platform_admin");
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim());
  const [addRole, setAddRole] = useState<EventRole>("participant");
  const search = useQuery({ queryKey: ["app", "pilot-search", dq], queryFn: () => pilotsApi.search(dq), enabled: canManage && dq.length >= 2 });

  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const add = useMutation({ mutationFn: (uid: string) => eventsApi.addParticipant(id, uid, addRole), onSuccess: invalidate });
  const change = useMutation({ mutationFn: (v: { uid: string; role: EventRole }) => eventsApi.updateParticipant(id, v.uid, v.role), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (uid: string) => eventsApi.removeParticipant(id, uid), onSuccess: invalidate });

  const items = parts.data?.items ?? [];
  const memberIds = new Set(items.filter((p) => p.status === "active").map((p) => p.user_id));

  return (
    <div className="space-y-6">
      <Link to={`/app/events/${id}`} className="inline-flex items-center gap-1 text-footnote text-fg-secondary hover:text-fg"><ArrowLeft className="size-4" />{event.data?.name ?? t("common.back")}</Link>
      <PageHeader title={t("event.participants")} subtitle={t("participants.lead")} />

      {canManage && (
        <Panel title={t("participants.add")}>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("participants.searchPlaceholder")} aria-label={t("participants.searchPlaceholder")} className="pl-9" />
            </div>
            <Select value={addRole} onValueChange={(v) => setAddRole(v as EventRole)}>
              <SelectTrigger className="sm:w-48" aria-label={t("participants.role")}><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{t(`role.event.${r}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {dq.length >= 2 && (
            <div className="mt-3">
              {search.isLoading ? <Loading /> : search.error ? <ErrorState error={search.error} /> : (search.data?.items.length ?? 0) === 0 ? (
                <p className="text-footnote text-fg-muted">{t("participants.noResults")}</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {search.data!.items.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{p.full_name}</div>
                        {p.public_id && <div className="telemetry text-caption text-fg-muted">@{p.public_id}</div>}
                      </div>
                      {memberIds.has(p.id) ? (
                        <Badge variant="muted">{t("participants.alreadyMember")}</Badge>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => add.mutate(p.id)} disabled={add.isPending}><UserPlus /> {t("participants.addAs", { role: t(`role.event.${addRole}`) })}</Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="mt-3"><FormError error={add.error} /></div>
        </Panel>
      )}

      <Panel title={t("participants.list", { n: items.filter((p) => p.status === "active").length })} bodyClassName="p-0">
        {parts.isLoading ? <Loading className="px-4" /> : parts.error ? <div className="p-4"><ErrorState error={parts.error} /></div> : items.length === 0 ? (
          <div className="p-4"><EmptyState title={t("participants.empty")} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-footnote">
              <thead className="text-left text-caption text-fg-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium">{t("common.name")}</th>
                  <th className="px-4 py-2 font-medium">{t("participants.role")}</th>
                  <th className="px-4 py-2 font-medium">{t("participants.joined")}</th>
                  <th className="px-4 py-2 font-medium"><span className="sr-only">{t("common.actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.user_id} className={`border-b border-border last:border-0 ${p.status === "removed" ? "text-fg-muted" : ""}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{p.full_name}</div>
                      {p.status === "removed" && <Badge variant="muted">{t("participants.removed")}</Badge>}
                    </td>
                    <td className="px-4 py-2.5">
                      {canManage && p.status === "active" ? (
                        <Select value={p.role} onValueChange={(v) => change.mutate({ uid: p.user_id, role: v as EventRole })}>
                          <SelectTrigger className="h-10 w-40" aria-label={t("participants.roleFor", { name: p.full_name })}><SelectValue /></SelectTrigger>
                          <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{t(`role.event.${r}`)}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : t(`role.event.${p.role}`)}
                    </td>
                    <td className="px-4 py-2.5 tnum">{fmtDate(p.joined_at, locale)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {canManage && p.status === "active" && p.user_id !== user?.id && (
                        <Button size="sm" variant="ghost" onClick={() => remove.mutate(p.user_id)} aria-label={t("participants.removeName", { name: p.full_name })}><UserMinus /> {t("participants.remove")}</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 pb-3 empty:hidden">{(change.error || remove.error) ? <FormError error={change.error ?? remove.error} /> : null}</div>
      </Panel>
    </div>
  );
}
