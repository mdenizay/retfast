import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/auth";
import { eventsApi } from "@/lib/api/endpoints";
import { EmptyState, ErrorState, Loading, PageHeader } from "@/components/common";
import { Input } from "@/components/ui/input";
import { EventRow } from "@/features/events/EventBits";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { id: "active,published", key: "events.filter.current" },
  { id: "active", key: "event.status.active" },
  { id: "completed", key: "event.status.completed" },
] as const;

export default function PublicEventsPage() {
  const { t } = useI18n();
  const { user } = useSession();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("active,published");
  const dq = useDeferredValue(q).trim();
  const events = useQuery({
    // user id in the key: signed-in users also see restricted events they belong to, with their role.
    queryKey: ["public", "events", status, dq, user?.id ?? null],
    queryFn: () => eventsApi.list({ status, q: dq || undefined, limit: 100 }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-10 sm:px-6">
      <PageHeader title={t("events.title")} subtitle={t("events.publicLead")} />
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-fg-muted" aria-hidden />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("events.search")} aria-label={t("events.search")} className="rounded-full bg-surface pl-11" />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("events.statusFilter")}>
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={status === f.id}
                onClick={() => setStatus(f.id)}
                className={cn("h-9 rounded-full px-4 text-footnote font-semibold transition-colors", status === f.id ? "bg-primary text-on-primary" : "bg-surface text-fg-secondary hover:text-fg")}
              >
                {t(f.key)}
              </button>
            ))}
          </div>
        </div>
        {events.isLoading ? <Loading /> : events.error ? <ErrorState error={events.error} onRetry={() => void events.refetch()} /> :
          (events.data?.items.length ?? 0) === 0 ? (
            <EmptyState title={t("events.emptyTitle")} body={dq ? t("events.emptySearch") : t("events.emptyPublic")} />
          ) : (
            <ul className="grid grid-cols-1 gap-3">
              {events.data!.items.map((e) => <EventRow key={e.id} event={e} to={`/events/${e.slug}`} />)}
            </ul>
          )}
      </div>
    </div>
  );
}
