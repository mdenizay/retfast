import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { eventsApi } from "@/lib/api/endpoints";
import { ErrorState } from "@/components/common";
import { FullScreenLoading } from "@/layouts/guards";
import { LiveView } from "@/features/live/LiveView";

export default function AppLivePage() {
  const { id = "" } = useParams();
  const event = useQuery({ queryKey: ["app", "event", id], queryFn: () => eventsApi.get(id) });
  if (event.isLoading) return <FullScreenLoading />;
  if (!event.data) return <div className="mx-auto max-w-xl p-8"><ErrorState error={event.error} onRetry={() => void event.refetch()} /></div>;
  return <LiveView event={event.data} mode="app" backHref={`/app/events/${id}`} />;
}
