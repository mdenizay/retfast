import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, CheckCircle2, ChevronRight, ScrollText, Users, XCircle } from "lucide-react";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { adminApi } from "@/lib/api/endpoints";
import type { AdminStats } from "@/lib/api/types";
import { fmtNumber, fmtTime } from "@/lib/format";
import { ErrorState, PageHeader, Panel } from "@/components/common";
import { cn } from "@/lib/utils";

type CounterKey = "active_events" | "pilots_in_air" | "stale_sessions" | "open_retrievals" | "pending_applications" | "recent_flights" | "users";

const COUNTERS: { key: CounterKey; label: MessageKey }[] = [
  { key: "active_events", label: "system.activeEvents" },
  { key: "pilots_in_air", label: "system.pilotsInAir" },
  { key: "stale_sessions", label: "system.staleSessions" },
  { key: "open_retrievals", label: "system.openRetrievals" },
  { key: "pending_applications", label: "system.pendingApplications" },
  { key: "recent_flights", label: "system.recentFlights" },
  { key: "users", label: "system.users" },
];

/** Counters the response actually contains; while loading, the known set with "—". */
function presentCounters(stats: AdminStats | undefined, loading: boolean) {
  if (loading || !stats) return loading ? COUNTERS.slice(0, 6) : [];
  return COUNTERS.filter((c) => typeof stats[c.key] === "number");
}

export default function AdminSystemPage() {
  const { t, locale } = useI18n();
  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: adminApi.stats, refetchInterval: 30_000 });
  const counters = presentCounters(stats.data, stats.isLoading);
  const sys = stats.data?.system_status;
  const checks = Object.entries(sys?.checks ?? {});

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("system.title")}
        subtitle={t("system.lead")}
        actions={stats.data?.generated_at && (
          <span className="telemetry text-caption text-fg-muted">{t("system.generated", { time: fmtTime(stats.data.generated_at, locale) })}</span>
        )}
      />

      {stats.error ? (
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
      ) : counters.length === 0 ? (
        <p className="text-footnote text-fg-muted">{t("system.noCounters")}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-busy={stats.isLoading}>
          {counters.map((c) => {
            const v = stats.data?.[c.key];
            return (
              <div key={c.key} className="flex flex-col-reverse rounded-3xl bg-surface p-5" data-counter={c.key}>
                <dt className="mt-1 text-footnote text-fg-muted">{t(c.label)}</dt>
                <dd className="text-title1 font-semibold tracking-tight text-fg tnum">{typeof v === "number" ? fmtNumber(v, locale) : "—"}</dd>
              </div>
            );
          })}
        </dl>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title={t("system.checks")} bodyClassName="p-0">
          {checks.length === 0 && !sys ? (
            <p className="p-4 text-footnote text-fg-muted">{stats.isLoading ? t("common.loading") : t("system.noChecks")}</p>
          ) : (
            <ul className="divide-y divide-fg/[0.06]">
              {checks.map(([name, state]) => {
                const ok = state === "ok";
                return (
                  <li key={name} className="flex items-center gap-3 px-4 py-3">
                    {ok ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <XCircle className="size-4 text-error" aria-hidden />}
                    <span className="telemetry flex-1">{name}</span>
                    <span className={cn("telemetry text-footnote", ok ? "text-success" : "text-error")}>{ok ? t("system.checkOk") : state}</span>
                  </li>
                );
              })}
              {sys && (typeof sys.outbox_depth === "number" || typeof sys.email_pending === "number" || typeof sys.email_failed_24h === "number") && (
                <li className="px-4 py-3">
                  <div className="text-caption font-medium text-fg-muted">{t("system.email")}</div>
                  <dl className="mt-2 grid grid-cols-3 gap-3">
                    {typeof sys.outbox_depth === "number" && <MiniStat label={t("system.outbox")} value={sys.outbox_depth} />}
                    {typeof sys.email_pending === "number" && <MiniStat label={t("system.emailPending")} value={sys.email_pending} />}
                    {typeof sys.email_failed_24h === "number" && <MiniStat label={t("system.emailFailed")} value={sys.email_failed_24h} warn={sys.email_failed_24h > 0} />}
                  </dl>
                </li>
              )}
            </ul>
          )}
        </Panel>

        <Panel title={t("system.shortcuts")} bodyClassName="p-0">
          <ul className="divide-y divide-fg/[0.06]">
            {([
              ["/app/admin/events", CalendarRange, "system.goEvents", "system.goEventsHint"],
              ["/app/admin/users", Users, "system.goUsers", "system.goUsersHint"],
              ["/app/admin/audit", ScrollText, "system.goAudit", "system.goAuditHint"],
            ] as const).map(([to, Icon, label, hint]) => (
              <li key={to}>
                <Link to={to} className="group flex items-center gap-3 px-4 py-3.5 hover:bg-accent">
                  <Icon className="size-[18px] text-fg-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{t(label)}</span>
                    <span className="block text-caption text-fg-muted">{t(hint)}</span>
                  </span>
                  <ChevronRight className="size-4 text-fg-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function MiniStat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  const { locale } = useI18n();
  return (
    <div>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className={cn("telemetry text-headline", warn ? "text-warning" : "text-fg")}>{fmtNumber(value, locale)}</dd>
    </div>
  );
}
