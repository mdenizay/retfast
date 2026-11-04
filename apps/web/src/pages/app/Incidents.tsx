import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, Siren } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { incidentsApi } from "@/lib/api/endpoints";
import { hasRole, isResponder, useSession } from "@/lib/auth";
import { fmtAge, fmtDateTime } from "@/lib/format";
import { useNow } from "@/hooks/useNow";
import { EmptyState, ErrorState, Loading, PageHeader } from "@/components/common";
import { ConnectionIndicator, IncidentStatusBadge, TestBadge } from "@/components/status";
import { useIncidentStream } from "@/features/incidents/useIncidentStream";
import { cn } from "@/lib/utils";

const FILTERS = [
  { v: "open,acknowledged,responding", k: "incident.filter.active" },
  { v: "open", k: "incident.status.open" },
  { v: "resolved", k: "incident.status.resolved" },
  { v: "cancelled", k: "incident.status.cancelled" },
  { v: "", k: "events.filter.all" },
] as const;

export default function IncidentsPage() {
  const { t, lang, locale } = useI18n();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "open,acknowledged,responding";
  const responder = isResponder(user) || hasRole(user, "event_organizer");
  const rt = useIncidentStream(responder);
  const now = useNow(1000);
  const q = useQuery({
    queryKey: ["incidents", "list", status],
    queryFn: () => incidentsApi.list({ status: status || undefined }),
    refetchInterval: 20_000,
  });
  const items = q.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav.incidents")}
        subtitle={responder ? t("incident.leadResponder") : t("incident.leadPilot")}
        actions={responder && rt.status !== "idle" ? <ConnectionIndicator status={rt.status} attempt={rt.attempt} /> : undefined}
      />
      <div className="flex items-start gap-3 rounded-md border border-border bg-surface p-3 text-footnote text-fg-secondary">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-emergency-text" aria-hidden />
        <p>{t("incident.disclaimer")}</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("incident.filterLabel")}>
        {FILTERS.map((f) => (
          <button key={f.v} type="button" aria-pressed={status === f.v}
            onClick={() => setParams(f.v ? { status: f.v } : { status: "" }, { replace: true })}
            className={cn("h-9 rounded-sm border px-3 text-footnote font-medium", status === f.v ? "border-fg bg-fg text-background" : "border-border text-fg-secondary hover:bg-accent")}>
            {t(f.k)}
          </button>
        ))}
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : items.length === 0 ? (
        <EmptyState icon={<Siren className="size-6" />} title={t("incident.empty")} body={t("incident.emptyBody")} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {items.map((i) => {
            const ageS = (now - Date.parse(i.received_at)) / 1000;
            return (
              <li key={i.id}>
                <Link to={`/app/incidents/${i.id}`} className={cn("flex flex-wrap items-center gap-3 px-4 py-3.5 hover:bg-accent", i.status === "open" && !i.is_test && "border-l-4 border-l-emergency")}>
                  <Siren className={cn("size-5", i.is_test ? "text-warning" : "text-emergency-text")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{i.pilot.full_name}</span>
                      {i.is_test && <TestBadge />}
                      <IncidentStatusBadge status={i.status} isTest={i.is_test} />
                    </div>
                    <div className="text-caption text-fg-muted tnum">
                      {fmtDateTime(i.received_at, locale)} · {t("incident.ago", { age: fmtAge(ageS, lang) })}
                      {i.message ? ` · “${i.message}”` : ""}
                    </div>
                  </div>
                  <span className="text-caption text-fg-muted">{t("incident.assignedCount", { n: i.assignments?.length ?? 0 })}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
