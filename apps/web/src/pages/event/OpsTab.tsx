import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import MapView from "@/components/MapView";
import { PilotRow, RetrieverRow } from "@/components/OpsRows";
import { FreshnessDot } from "@/components/Telemetry";
import { useI18n } from "@/i18n";
import { fmtAgo } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useOpsLive } from "@/lib/useOpsLive";
import { Maximize2, Siren } from "lucide-react";

/**
 * Compact operations view inside the event page. The full-bleed console at
 * /events/:id/ops is the primary surface; this is the at-a-glance version.
 */
export default function OpsTab({ eventId }: { eventId: string; isOperator?: boolean }) {
  const { m, locale } = useI18n();
  const { zones, pilots, retrievers, emergencies, names, isOperator, live, reload } =
    useOpsLive(eventId);
  const [busy, setBusy] = useState(false);

  async function updateEmergency(id: string, action: "acknowledge" | "resolve") {
    setBusy(true);
    const { error } = await supabase.rpc("update_emergency", { p_emergency: id, p_action: action });
    setBusy(false);
    if (error) toast.error(error.message);
    else void reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <FreshnessDot ageSec={live ? 0 : null} />
          {live ? m.ops.liveFeed : m.ops.reconnecting}
        </div>
        <Button asChild className="ml-auto h-11 gap-2">
          <Link to={`/events/${eventId}/ops`}>
            <Maximize2 className="size-4" />
            {m.ops.openConsole}
          </Link>
        </Button>
      </div>

      {emergencies.length > 0 && (
        <Card className="border-destructive">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <Siren className="size-4 animate-pulse" />
              {m.ops.emergencies} ({emergencies.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {emergencies.map((e) => (
              <div key={e.id} className="rounded-md border border-destructive/40 p-3">
                <p className="text-sm font-medium">
                  {m.emergencies.raisedBy}: {names[e.user_id] ?? e.user_id.slice(0, 8)}
                </p>
                {e.message && <p className="text-sm text-muted-foreground">{e.message}</p>}
                <p className="text-xs text-muted-foreground">{fmtAgo(e.created_at, locale)}</p>
                {isOperator && (
                  <div className="mt-2 flex gap-2">
                    {e.status === "open" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => updateEmergency(e.id, "acknowledge")}
                      >
                        {m.ops.acknowledge}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => updateEmergency(e.id, "resolve")}
                    >
                      {m.ops.resolve}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <MapView className="h-[380px] w-full rounded-md border" zones={zones} />

      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-2">
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {m.ops.pilots}
          </h3>
          {pilots.length === 0 && <p className="text-sm text-muted-foreground">{m.ops.noPilots}</p>}
          {pilots.map((p) => (
            <PilotRow key={p.task.id} pilot={p} />
          ))}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {m.ops.retrievers}
          </h3>
          {retrievers.length === 0 && (
            <p className="text-sm text-muted-foreground">{m.ops.noRetrievers}</p>
          )}
          {retrievers.map((r) => (
            <RetrieverRow key={r.user_id} retriever={r} />
          ))}
        </section>
      </div>
    </div>
  );
}
