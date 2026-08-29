import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/i18n";
import { fmtDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { EventRole, ParticipationRequest } from "@/lib/types";

export default function RequestsTab({ eventId }: { eventId: string }) {
  const { m, locale } = useI18n();
  const [requests, setRequests] = useState<ParticipationRequest[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("participation_requests")
      .select("*, profile:profiles!participation_requests_user_id_fkey(id, display_name)")
      .eq("event_id", eventId)
      .eq("status", "pending")
      .order("created_at");
    setRequests((data as unknown as ParticipationRequest[]) ?? []);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(req: ParticipationRequest, approve: boolean) {
    const { error } = await supabase.rpc("decide_participation", {
      p_request: req.id,
      p_approve: approve,
    });
    if (error) toast.error(error.message);
    else void load();
  }

  if (requests.length === 0)
    return <p className="text-sm text-muted-foreground">{m.requests.empty}</p>;

  return (
    <div className="space-y-3">
      {requests.map((r) => (
        <Card key={r.id}>
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <div className="min-w-48">
              <p className="font-medium">{r.profile?.display_name ?? r.user_id.slice(0, 8)}</p>
              <p className="text-xs text-muted-foreground">{fmtDateTime(r.created_at, locale)}</p>
            </div>
            <Badge variant="secondary">{m.roles[r.requested_role as EventRole]}</Badge>
            {r.message && (
              <p className="max-w-md text-sm text-muted-foreground">“{r.message}”</p>
            )}
            <div className="ml-auto flex gap-2">
              <Button size="sm" onClick={() => decide(r, true)}>
                {m.requests.approve}
              </Button>
              <Button size="sm" variant="outline" onClick={() => decide(r, false)}>
                {m.requests.reject}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
