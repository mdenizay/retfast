import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { eventsApi } from "@/lib/api/endpoints";
import { useSession } from "@/lib/auth";
import { ErrorState } from "@/components/common";
import { FullScreenLoading } from "@/layouts/guards";
import { LiveView } from "@/features/live/LiveView";

export default function PublicLivePage() {
  const { slug = "" } = useParams();
  const { user } = useSession();
  const event = useQuery({ queryKey: ["public", "event", slug, user?.id ?? null], queryFn: () => eventsApi.get(slug) });
  if (event.isLoading) return <FullScreenLoading />;
  if (!event.data) return <div className="mx-auto max-w-xl p-8"><ErrorState error={event.error} onRetry={() => void event.refetch()} /></div>;
  return <LiveView event={event.data} mode="public" backHref={`/events/${slug}`} />;
}
