import { useDeferredValue, useState } from "react";
import { Link } from "react-router";
import { CalendarRange, Inbox, Plus, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { isAdmin, useSession } from "@/lib/auth";
import type { RfEvent } from "@/lib/api/types";
import { EmptyState, ErrorState, Loading, PageHeader } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EventRow } from "@/features/events/EventBits";
import { useMyEvents } from "@/layouts/AppLayout";

type Filter = "current" | "past" | "all";

export default function AppEventsPage() {
  const { t, locale } = useI18n();
  const { user } = useSession();
  const mine = useMyEvents();
  const [filter, setFilter] = useState<Filter>("current");
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q).trim().toLocaleLowerCase(locale);

  const list = (mine.data?.items ?? []).filter((e) => {
    const past = e.status === "completed" || e.status === "archived";
    if (filter === "current" && past) return false;
    if (filter === "past" && !past) return false;
    return !dq || e.name.toLocaleLowerCase(locale).includes(dq) || e.location_name.toLocaleLowerCase(locale).includes(dq);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("events.mineTitle")}
        subtitle={t("events.mineLead")}
        actions={
          <>
            <Button asChild variant="outline"><Link to="/events">{t("events.discover")}</Link></Button>
            {isAdmin(user) && <Button asChild><Link to="/app/events/new"><Plus /> {t("events.new")}</Link></Button>}
          </>
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("events.searchMine")} aria-label={t("events.searchMine")} className="pl-9" />
        </div>
        <div className="flex gap-1.5" role="group" aria-label={t("events.filterLabel")}>
          {(["current", "past", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={
                filter === f
                  ? "h-9 rounded-sm border border-fg bg-fg px-3 text-footnote font-medium text-background"
                  : "h-9 rounded-sm border border-border px-3 text-footnote font-medium text-fg-secondary hover:bg-accent"
              }
            >
              {t(`events.f.${f}`)}
            </button>
          ))}
        </div>
      </div>
      {mine.isLoading ? <Loading /> : mine.error ? <ErrorState error={mine.error} onRetry={() => void mine.refetch()} /> :
        list.length === 0 ? (
          <EmptyState icon={<CalendarRange className="size-6" />} title={t("home.noEvents")} body={t("home.noEventsBody")} />
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border bg-surface [&>li:last-child>a]:border-b-0">
            {list.map((e) => <EventRow key={e.id} event={e} to={`/app/events/${e.id}`} attention={<PendingChip event={e} />} />)}
          </ul>
        )}
    </div>
  );
}

function PendingChip({ event }: { event: RfEvent }) {
  const { t } = useI18n();
  const n = event.counts?.pending_applications ?? 0;
  if (!event.me?.is_organizer || n === 0) return null;
  return (
    <Badge variant="warning" className="hidden sm:inline-flex">
      <Inbox aria-hidden />
      {t("events.pendingChip", { n })}
    </Badge>
  );
}
