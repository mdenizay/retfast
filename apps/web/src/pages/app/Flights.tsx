import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Filter, Plane, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { eventsApi, flightsApi } from "@/lib/api/endpoints";
import { fmtDateTime, fmtDistance, fmtDuration, fmtAltitude } from "@/lib/format";
import { EmptyState, ErrorState, Loading, PageHeader } from "@/components/common";
import { FlightStatusBadge, SimBadge } from "@/components/status";
import { cn } from "@/lib/utils";

export default function FlightsPage() {
  const { t, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const pilotId = params.get("pilot_id") ?? undefined;
  const eventId = params.get("event_id") ?? undefined;
  const flights = useQuery({
    queryKey: ["app", "flights", status, pilotId, eventId],
    queryFn: () => flightsApi.list({ status: status || undefined, pilot_id: pilotId, event_id: eventId, limit: 100 }),
  });
  const items = flights.data?.items ?? [];
  // Event names come from the user's own event list (cached by the layout); unknown ids render "—".
  const events = useQuery({ queryKey: ["flights", "event-names"], queryFn: () => eventsApi.list({ mine: true, limit: 200 }), staleTime: 60_000 });
  const eventNames = new Map((events.data?.items ?? []).map((e) => [e.id, e.name] as const));
  const setStatus = (s: string) => {
    const p = new URLSearchParams(params);
    if (s) p.set("status", s); else p.delete("status");
    setParams(p, { replace: true });
  };
  return (
    <div className="space-y-6">
      <PageHeader title={t("flights.title")} subtitle={t("flights.lead")} />
      {(pilotId || eventId) && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-secondary/40 bg-secondary/5 px-3 py-2.5 text-footnote">
          <Filter className="size-4 text-secondary" aria-hidden />
          <span className="font-medium">{[pilotId && t("flights.filterPilot"), eventId && t("flights.filterEvent")].filter(Boolean).join(" · ")}</span>
          <span className="text-fg-secondary">{t("flights.leadFiltered")}</span>
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline"
            onClick={() => {
              const p = new URLSearchParams(params);
              p.delete("pilot_id");
              p.delete("event_id");
              setParams(p, { replace: true });
            }}
          >
            <X className="size-4" aria-hidden />{t("flights.clearFilter")}
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("flights.statusFilter")}>
        {[["", t("flights.filter.all")], ["recording", t("flight.status.recording")], ["ended", t("flight.status.ended")]].map(([v, l]) => (
          <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v!)}
            className={cn("h-9 rounded-sm border px-3 text-footnote font-medium", status === v ? "border-fg bg-fg text-background" : "border-border text-fg-secondary hover:bg-accent")}>
            {l}
          </button>
        ))}
      </div>
      {flights.isLoading ? <Loading /> : flights.error ? <ErrorState error={flights.error} onRetry={() => void flights.refetch()} /> : items.length === 0 ? (
        <EmptyState icon={<Plane className="size-6" />} title={t("flights.emptyTitle")} body={t("flights.emptyBody")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-footnote">
            <thead className="text-left text-caption text-fg-muted">
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 font-medium">{t("flights.started")}</th>
                <th className="px-4 py-2.5 font-medium">{t("flights.pilot")}</th>
                <th className="px-4 py-2.5 font-medium">{t("flights.event")}</th>
                <th className="px-4 py-2.5 font-medium">{t("flights.status")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("flight.duration")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("flight.distance")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("flight.maxAlt")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <tr key={f.id} className="border-b border-border last:border-0 hover:bg-accent">
                  <td className="px-4 py-3 tnum"><Link to={`/app/flights/${f.id}`} className="font-medium hover:underline">{fmtDateTime(f.started_at, locale)}</Link></td>
                  <td className="px-4 py-3">{f.pilot.full_name}</td>
                  <td className="px-4 py-3">
                    {f.event_id ? (
                      <Link to={`/app/events/${f.event_id}`} className="text-fg-secondary hover:underline">{eventNames.get(f.event_id) ?? "—"}</Link>
                    ) : <span className="text-fg-muted">{t("flights.noEvent")}</span>}
                  </td>
                  <td className="px-4 py-3"><span className="inline-flex gap-1.5"><FlightStatusBadge status={f.status} />{f.is_simulated && <SimBadge />}</span></td>
                  <td className="telemetry px-4 py-3 text-right">{fmtDuration(f.stats.duration_s)}</td>
                  <td className="telemetry px-4 py-3 text-right">{fmtDistance(f.stats.distance_m, locale)}</td>
                  <td className="telemetry px-4 py-3 text-right">{fmtAltitude(f.stats.max_gps_alt_m, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
