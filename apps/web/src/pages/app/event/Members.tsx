import { useDeferredValue, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, Search, Trash2, UserPlus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { eventsApi, usersApi } from "@/lib/api/endpoints";
import { useSession } from "@/lib/auth";
import { MEMBER_ROLES, type Member, type MemberRole, type UserSearchItem } from "@/lib/api/types";
import { fmtDate } from "@/lib/format";
import { EmptyState, ErrorState, FormError, Loading, NameAvatar, Panel } from "@/components/common";
import { RoleBadge } from "@/components/status";
import { ROLE_ICON } from "@/components/stateIcons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RoleChooser } from "@/features/events/RoleChooser";
import { useEventContext } from "@/features/events/context";
import { ApplicationsSection } from "./Applications";

/** Applications and members on one screen: decide applications first, then manage the roster. */
export default function PeoplePage() {
  return (
    <div className="space-y-10">
      <ApplicationsSection />
      <MembersSection />
    </div>
  );
}

function MembersSection() {
  const { t } = useI18n();
  const { event, refetch: refetchEvent } = useEventContext();
  const qc = useQueryClient();
  const key = ["app", "members", event.id];
  const members = useQuery({ queryKey: key, queryFn: () => eventsApi.members(event.id) });
  const [removing, setRemoving] = useState<Member | null>(null);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: key });
    refetchEvent();
  };
  const change = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: MemberRole }) => eventsApi.updateMember(event.id, userId, role),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (m: Member) => eventsApi.removeMember(event.id, m.user_id),
    onSuccess: () => {
      setRemoving(null);
      invalidate();
    },
  });

  const list = members.data ?? [];
  const active = list.filter((m) => m.status === "active");
  const removed = list.filter((m) => m.status === "removed");
  const groups: { role: MemberRole; items: Member[] }[] = MEMBER_ROLES.map((role) => ({
    role,
    items: active.filter((m) => m.role === role).sort((a, b) => a.full_name.localeCompare(b.full_name)),
  }));
  const organizersOnly = active.filter((m) => m.is_organizer && !m.role);

  return (
    <section className="space-y-4" aria-labelledby="members-title">
      <h2 id="members-title" className="flex items-baseline gap-2 text-title3 font-semibold tracking-tight">
        {t("eventTab.members")}
        {members.data && <span className="text-body font-medium text-fg-muted tnum">{active.length}</span>}
      </h2>
      <AddMember existing={new Set(active.map((m) => m.user_id))} onAdded={invalidate} />
      <FormError error={change.error} />
      {members.isLoading ? <Loading /> : members.error ? <ErrorState error={members.error} onRetry={() => void members.refetch()} /> :
        active.length === 0 ? <EmptyState title={t("members.empty")} body={t("members.emptyBody")} /> : (
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            {groups.map((g) => {
              const Icon = ROLE_ICON[g.role];
              return (
                <Panel
                  key={g.role}
                  title={<span className="inline-flex items-center gap-2"><Icon className="size-4" aria-hidden />{t(`members.group.${g.role}`)} <span className="tnum text-fg-muted">{g.items.length}</span></span>}
                  bodyClassName="p-0"
                >
                  {g.items.length === 0 ? <p className="p-4 text-footnote text-fg-muted">{t("members.noneInGroup")}</p> : (
                    <ul className="divide-y divide-fg/[0.06]" aria-label={t(`members.group.${g.role}`)}>
                      {g.items.map((m) => (
                        <MemberRow key={m.user_id} m={m} busy={change.isPending} onRole={(role) => change.mutate({ userId: m.user_id, role })} onRemove={() => setRemoving(m)} />
                      ))}
                    </ul>
                  )}
                </Panel>
              );
            })}
          </div>
        )}
      {organizersOnly.length > 0 && (
        <Panel title={t("members.organizersOnly")} bodyClassName="p-0">
          <ul className="divide-y divide-fg/[0.06]">
            {organizersOnly.map((m) => (
              <MemberRow key={m.user_id} m={m} busy={change.isPending} onRole={(role) => change.mutate({ userId: m.user_id, role })} />
            ))}
          </ul>
          <p className="border-t border-border px-4 py-2.5 text-caption text-fg-muted">{t("members.organizersHint")}</p>
        </Panel>
      )}
      {removed.length > 0 && (
        <details className="rounded-3xl bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-footnote font-medium text-fg-secondary">{t("members.removed", { n: removed.length })}</summary>
          <ul className="divide-y divide-fg/[0.06] border-t border-border">
            {removed.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 px-4 py-2.5 text-footnote text-fg-muted">
                <span className="flex-1">{m.full_name}</span>
                {m.role && <span>{t(`role.${m.role}`)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("members.removeTitle", { name: removing?.full_name ?? "" })}</DialogTitle>
            <DialogDescription>{t("members.removeBody")}</DialogDescription>
          </DialogHeader>
          <FormError error={remove.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => removing && remove.mutate(removing)} disabled={remove.isPending}>{t("members.remove")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function MemberRow({ m, busy, onRole, onRemove }: { m: Member; busy: boolean; onRole: (r: MemberRole) => void; onRemove?: () => void }) {
  const { t, locale } = useI18n();
  const { user } = useSession();
  const self = m.user_id === user?.id;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <NameAvatar name={m.full_name} accent={self} className="size-10" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-medium">{m.full_name}</span>
          {m.is_organizer && <RoleBadge role="organizer" />}
        </div>
        <div className="flex flex-wrap gap-x-3 text-caption text-fg-muted">
          {m.phone ? (
            <a href={`tel:${m.phone.replace(/\s+/g, "")}`} className="inline-flex min-w-0 max-w-full items-center gap-1 text-fg-secondary tnum hover:text-brand">
              <Phone className="size-3 shrink-0" aria-hidden /><span className="truncate">{m.phone}</span>
            </a>
          ) : (
            <span>{t("members.noPhone")}</span>
          )}
          <span className="tnum">{t("members.joined", { date: fmtDate(m.joined_at, locale) })}</span>
        </div>
      </div>
      <Select value={m.role ?? ""} onValueChange={(v) => onRole(v as MemberRole)} disabled={busy}>
        <SelectTrigger size="sm" className="w-28 shrink-0 rounded-full sm:w-32" aria-label={t("members.roleFor", { name: m.full_name })}>
          <SelectValue placeholder={t("members.giveRole")} />
        </SelectTrigger>
        <SelectContent>
          {MEMBER_ROLES.map((r) => <SelectItem key={r} value={r}>{t(`role.${r}`)}</SelectItem>)}
        </SelectContent>
      </Select>
      {/* Fixed trailing slot keeps the role selects aligned whether or not the row can be removed. */}
      <span className="grid size-9 shrink-0 place-items-center">
        {onRemove && !self && (
          <Button size="icon-sm" variant="ghost" className="text-fg-muted hover:text-error" aria-label={t("members.removeName", { name: m.full_name })} onClick={onRemove}>
            <Trash2 />
          </Button>
        )}
      </span>
    </li>
  );
}

function AddMember({ existing, onAdded }: { existing: Set<string>; onAdded: () => void }) {
  const { t } = useI18n();
  const { event } = useEventContext();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<MemberRole>("pilot");
  const dq = useDeferredValue(q.trim());
  const search = useQuery({ queryKey: ["users", "search", dq], queryFn: () => usersApi.search(dq), enabled: dq.length >= 2 });
  const add = useMutation({
    mutationFn: (u: UserSearchItem) => eventsApi.addMember(event.id, u.id, role),
    onSuccess: onAdded,
  });
  const items = search.data?.items ?? [];
  return (
    <Panel title={<span className="inline-flex items-center gap-2"><UserPlus className="size-4" aria-hidden />{t("members.addTitle")}</span>}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("members.searchPlaceholder")} aria-label={t("members.searchPlaceholder")} className="rounded-full pl-11" />
        </div>
        <RoleChooser name="add-role" value={role} onChange={setRole} label={t("members.addAsRole")} size="sm" />
      </div>
      {dq.length >= 2 && (
        <div className="mt-3">
          {search.isLoading ? <Loading /> : search.error ? <ErrorState error={search.error} /> : items.length === 0 ? (
            <p className="text-footnote text-fg-muted">{t("members.noResults")}</p>
          ) : (
            <ul className="divide-y divide-fg/[0.06] overflow-hidden rounded-2xl bg-muted">
              {items.slice(0, 10).map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{u.full_name}</div>
                    <div className="truncate text-caption text-fg-muted">{u.email}</div>
                  </div>
                  {existing.has(u.id) ? (
                    <span className="text-caption text-fg-muted">{t("members.already")}</span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => add.mutate(u)} disabled={add.isPending}>
                      {t("members.addAs", { role: t(`role.${role}`) })}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2"><FormError error={add.error} /></div>
        </div>
      )}
    </Panel>
  );
}
