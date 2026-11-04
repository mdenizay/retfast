import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Plane } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { flightsApi } from "@/lib/api/endpoints";
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
  const setStatus = (s: string) => {
    const p = new URLSearchParams(params);
    if (s) p.set("status", s); else p.delete("status");
    setParams(p, { replace: true });
  };
  return (
    <div className="space-y-6">
      <PageHeader title={t("nav.flights")} subtitle={pilotId ? t("flights.leadPilot") : t("flights.lead")} />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("flights.statusFilter")}>
        {[["", t("events.filter.all")], ["recording", t("flight.status.recording")], ["ended", t("flight.status.ended")]].map(([v, l]) => (
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
