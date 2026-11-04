import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { rescueApi } from "@/lib/api/endpoints";
import type { AssignmentStatus } from "@/lib/api/types";
import { hasRole, useSession } from "@/lib/auth";
import { fmtAge, fmtCoord, fmtTime } from "@/lib/format";
import { useNow } from "@/hooks/useNow";
import { EmptyState, ErrorState, FormError, Loading, PageHeader, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NEXT: AssignmentStatus[] = ["assigned", "en_route", "on_scene", "completed", "withdrawn"];

export default function RescuePage() {
  const { t, lang, locale } = useI18n();
  const { user } = useSession();
  const qc = useQueryClient();
  const now = useNow(5000);
  const team = useQuery({ queryKey: ["rescue", "team"], queryFn: rescueApi.team, refetchInterval: 15_000 });
  const mine = useQuery({ queryKey: ["rescue", "mine"], queryFn: rescueApi.myAssignments, refetchInterval: 15_000 });
  const me = team.data?.items.find((m) => m.user_id === user?.id);
  const availability = useMutation({
    mutationFn: (a: "available" | "unavailable") => rescueApi.setAvailability(a),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rescue", "team"] }),
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: AssignmentStatus }) => rescueApi.setAssignmentStatus(v.id, v.status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rescue"] });
      void qc.invalidateQueries({ queryKey: ["incidents"] });
    },
  });
  const isOperator = hasRole(user, "rescue_operator");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav.rescue")}
        subtitle={t("rescue.lead")}
        actions={isOperator && (
          <div className="flex items-center gap-2">
            <span className="text-footnote text-fg-secondary">{t("rescue.myStatus")}:</span>
            <Button variant={me?.availability === "available" ? "default" : "outline"} onClick={() => availability.mutate("available")} aria-pressed={me?.availability === "available"}>{t("rescue.available")}</Button>
            <Button variant={me?.availability === "unavailable" ? "secondary" : "outline"} onClick={() => availability.mutate("unavailable")} aria-pressed={me?.availability === "unavailable"}>{t("rescue.unavailable")}</Button>
          </div>
        )}
      />
      <FormError error={availability.error} />

      <Panel title={t("rescue.myAssignments")} bodyClassName="p-0">
        {mine.isLoading ? <Loading className="px-4" /> : mine.error ? <div className="p-4"><ErrorState error={mine.error} /></div> : (mine.data?.items.length ?? 0) === 0 ? (
          <p className="p-4 text-footnote text-fg-muted">{t("rescue.noAssignments")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {mine.data!.items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Link to={`/app/incidents/${a.incident_id}`} className="min-w-0 flex-1 font-medium text-primary hover:underline">{t("rescue.incident")} {a.incident_id.slice(0, 8)}</Link>
                <span className="text-caption text-fg-muted tnum">{t("rescue.assignedAt", { time: fmtTime(a.assigned_at, locale, false) })}</span>
                <Select value={a.status} onValueChange={(v) => setStatus.mutate({ id: a.id, status: v as AssignmentStatus })}>
                  <SelectTrigger className="h-10 w-44" aria-label={t("rescue.assignmentStatus")}><SelectValue /></SelectTrigger>
                  <SelectContent>{NEXT.map((s) => <SelectItem key={s} value={s}>{t(`assignment.${s}`)}</SelectItem>)}</SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        )}
        <div className="px-4 empty:hidden">{setStatus.error ? <div className="pb-3"><FormError error={setStatus.error} /></div> : null}</div>
      </Panel>

      <Panel title={t("rescue.team")} bodyClassName="p-0">
        {team.isLoading ? <Loading className="px-4" /> : team.error ? <div className="p-4"><ErrorState error={team.error} /></div> : (team.data?.items.length ?? 0) === 0 ? (
          <div className="p-4"><EmptyState icon={<LifeBuoy className="size-6" />} title={t("rescue.noTeam")} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-footnote">
              <thead className="text-left text-caption text-fg-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium">{t("common.name")}</th>
                  <th className="px-4 py-2 font-medium">{t("rescue.availability")}</th>
                  <th className="px-4 py-2 font-medium">{t("rescue.activeAssignment")}</th>
                  <th className="px-4 py-2 font-medium">{t("rescue.lastPosition")}</th>
                </tr>
              </thead>
              <tbody>
                {team.data!.items.map((m) => (
                  <tr key={m.user_id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium">{m.full_name}</td>
                    <td className="px-4 py-2.5">
                      {m.availability === "available" ? <Badge variant="success">● {t("rescue.available")}</Badge> : <Badge variant="muted">○ {t("rescue.unavailable")}</Badge>}
                    </td>
                    <td className="px-4 py-2.5">
                      {m.active_assignment ? (
                        <Link to={`/app/incidents/${m.active_assignment.incident_id}`} className="text-primary hover:underline">{t(`assignment.${m.active_assignment.status}`)}</Link>
                      ) : <span className="text-fg-muted">—</span>}
                    </td>
                    <td className="telemetry px-4 py-2.5 text-caption">
                      {m.last_position ? `${fmtCoord(m.last_position.lat, m.last_position.lon)} · ${fmtAge((now - Date.parse(m.last_position.t)) / 1000, lang)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
