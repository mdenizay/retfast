import { useDeferredValue, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { pilotsApi } from "@/lib/api/endpoints";
import { EmptyState, ErrorState, Loading, PageHeader } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export default function PilotsPage() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim());
  const pilots = useQuery({ queryKey: ["app", "pilots", dq], queryFn: () => pilotsApi.search(dq) });
  const items = pilots.data?.items ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title={t("nav.pilots")} subtitle={t("pilots.lead")} />
      <div className="relative sm:w-96">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("pilots.search")} aria-label={t("pilots.search")} className="pl-9" />
      </div>
      {pilots.isLoading ? <Loading /> : pilots.error ? <ErrorState error={pilots.error} onRetry={() => void pilots.refetch()} /> : items.length === 0 ? (
        <EmptyState title={t("pilots.empty")} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.full_name}</div>
                {p.public_id && <div className="telemetry text-caption text-fg-muted">@{p.public_id}</div>}
              </div>
              <div className="flex flex-wrap gap-1">{p.roles.map((r) => <Badge key={r} variant="muted">{t(`role.global.${r}`)}</Badge>)}</div>
              <Link to={`/app/flights?pilot_id=${p.id}`} className="text-footnote text-primary hover:underline">{t("pilots.flights")}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
