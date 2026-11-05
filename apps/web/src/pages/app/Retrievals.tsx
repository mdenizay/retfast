import { Navigate } from "react-router";
import { Car } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { EmptyState, ErrorState, Loading, PageHeader } from "@/components/common";
import { EventRow } from "@/features/events/EventBits";
import { useMyEvents } from "@/layouts/AppLayout";

/** Entry point for retrievers: one event → straight to its retrieval page; several → pick one. */
export default function RetrievalsPage() {
  const { t } = useI18n();
  const mine = useMyEvents();
  if (mine.isLoading) return <Loading />;
  if (mine.error) return <ErrorState error={mine.error} onRetry={() => void mine.refetch()} />;
  const events = (mine.data?.items ?? []).filter((e) => e.me?.role === "retriever" && e.status !== "archived");
  const current = events.filter((e) => e.status === "active");
  if (current.length === 1) return <Navigate to={`/app/events/${current[0]!.id}/retrievals`} replace />;
  return (
    <div className="space-y-6">
      <PageHeader title={t("nav.retrievals")} subtitle={t("retrievalsPage.lead")} />
      {events.length === 0 ? (
        <EmptyState icon={<Car className="size-6" />} title={t("retrievalsPage.none")} body={t("retrievalsPage.noneBody")} />
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border bg-surface">
          {events.map((e) => <EventRow key={e.id} event={e} to={`/app/events/${e.id}/retrievals`} />)}
        </ul>
      )}
    </div>
  );
}
