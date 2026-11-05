import { Navigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { eventsApi } from "@/lib/api/endpoints";
import { useSession } from "@/lib/auth";
import { eventAccess } from "@/lib/roles";
import { ErrorState } from "@/components/common";
import { FullScreenLoading, NoAccess } from "@/layouts/guards";
import { LiveView } from "@/features/live/LiveView";

/**
 * /app/events/:id/live — operations room for organizers, observers and admins; pilots get the map
 * the API shows them; retrievers don't get the general map (contract) and go to "My retrievals".
 */
export default function EventLivePage() {
  const { id = "" } = useParams();
  const { user } = useSession();
  const event = useQuery({ queryKey: ["app", "event", id], queryFn: () => eventsApi.get(id) });
  if (event.isLoading) return <FullScreenLoading />;
  if (!event.data) return <div className="mx-auto max-w-xl p-8"><ErrorState error={event.error} onRetry={() => void event.refetch()} /></div>;
  const access = eventAccess(event.data, user);
  const back = `/app/events/${id}`;
  if (access.canOperate) return <LiveView event={event.data} mode="ops" canManage={access.canManage} backHref={back} />;
  if (access.isRetriever) return <Navigate to={`/app/events/${id}/retrievals`} replace />;
  if (access.canSeePilotMap) return <LiveView event={event.data} mode="pilot" backHref={back} />;
  return <div className="p-8"><NoAccess /></div>;
}
