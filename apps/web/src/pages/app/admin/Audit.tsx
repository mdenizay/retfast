import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminApi } from "@/lib/api/endpoints";
import { fmtDateTime } from "@/lib/format";
import { EmptyState, ErrorState, Loading, PageHeader } from "@/components/common";
import { Input } from "@/components/ui/input";

export default function AdminAuditPage() {
  const { t, locale } = useI18n();
  const [action, setAction] = useState("");
  const da = useDeferredValue(action.trim());
  const q = useQuery({ queryKey: ["admin", "audit", da], queryFn: () => adminApi.audit({ action: da || undefined, limit: 200 }) });
  const items = q.data?.items ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title={t("admin.auditTitle")} subtitle={t("admin.auditLead")} />
      <div className="relative sm:w-96">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
        <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder={t("admin.filterAction")} aria-label={t("admin.filterAction")} className="telemetry pl-9" />
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : items.length === 0 ? (
        <EmptyState title={t("admin.noAudit")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-footnote">
            <thead className="text-left text-caption text-fg-muted">
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 font-medium">{t("admin.time")}</th>
                <th className="px-4 py-2.5 font-medium">{t("admin.actor")}</th>
                <th className="px-4 py-2.5 font-medium">{t("admin.action")}</th>
                <th className="px-4 py-2.5 font-medium">{t("admin.target")}</th>
                <th className="px-4 py-2.5 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-border align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-2.5 tnum">{fmtDateTime(e.created_at, locale)}</td>
                  <td className="px-4 py-2.5">{e.actor?.full_name ?? e.actor_id ?? t("admin.system")}</td>
                  <td className="telemetry px-4 py-2.5">{e.action}</td>
                  <td className="telemetry px-4 py-2.5 text-caption text-fg-secondary">
                    {e.target_type ? `${e.target_type}${e.target_id ? `:${e.target_id.slice(0, 8)}` : ""}` : "—"}
                    {e.details && Object.keys(e.details).length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-fg-muted">{t("admin.details")}</summary>
                        <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap">{JSON.stringify(e.details, null, 2)}</pre>
                      </details>
                    )}
                  </td>
                  <td className="telemetry px-4 py-2.5 text-caption">{e.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
