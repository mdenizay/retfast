import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Filter, Navigation2, Plane, X } from "lucide-react";
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
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl bg-secondary/12 px-4 py-3.5 text-footnote">
          <Filter className="size-4 text-secondary" aria-hidden />
          <span className="font-medium">{[pilotId && t("flights.filterPilot"), eventId && t("flights.filterEvent")].filter(Boolean).join(" · ")}</span>
          <span className="text-fg-secondary">{t("flights.leadFiltered")}</span>
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 font-medium font-semibold text-brand underline-offset-4 transition-colors hover:underline"
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
            className={cn("h-9 rounded-full px-4 text-footnote font-semibold transition-colors", status === v ? "bg-primary text-on-primary" : "bg-surface text-fg-secondary hover:text-fg")}>
            {l}
          </button>
        ))}
      </div>
      {flights.isLoading ? <Loading /> : flights.error ? <ErrorState error={flights.error} onRetry={() => void flights.refetch()} /> : items.length === 0 ? (
        <EmptyState icon={<Plane className="size-6" />} title={t("flights.emptyTitle")} body={t("flights.emptyBody")} />
      ) : (
        <ul className="grid grid-cols-1 gap-2.5">
          {items.map((f) => (
            <li key={f.id} className="min-w-0">
              <Link
                to={`/app/flights/${f.id}`}
                className="group flex flex-wrap items-center gap-x-4 gap-y-3 rounded-3xl bg-surface p-4 transition-colors hover:bg-surface-elevated sm:flex-nowrap sm:px-5"
              >
                <span className={cn("grid size-12 shrink-0 place-items-center rounded-full", f.status === "recording" ? "bg-success/15 text-success" : "bg-muted text-fg-secondary")} aria-hidden>
                  <Navigation2 className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-semibold text-fg tnum">{fmtDateTime(f.started_at, locale)}</span>
                    <FlightStatusBadge status={f.status} />
                    {f.is_simulated && <SimBadge />}
                  </span>
                  <span className="mt-0.5 block truncate text-footnote text-fg-muted">
                    {f.pilot.full_name} · {f.event_id ? eventNames.get(f.event_id) ?? "—" : t("flights.noEvent")}
                  </span>
                </span>
                <span className="grid w-full grid-cols-3 gap-2 sm:w-auto sm:min-w-[19rem]">
                  <FlightFigure label={t("flight.duration")} value={fmtDuration(f.stats.duration_s)} />
                  <FlightFigure label={t("flight.distance")} value={fmtDistance(f.stats.distance_m, locale)} />
                  <FlightFigure label={t("flight.maxAlt")} value={fmtAltitude(f.stats.max_gps_alt_m, locale)} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FlightFigure({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-2xl bg-muted px-3 py-2">
      <span className="block text-body font-semibold text-fg tnum">{value}</span>
      <span className="block truncate text-caption text-fg-muted">{label}</span>
    </span>
  );
}
