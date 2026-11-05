import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/lib/i18n";
import { eventsApi } from "@/lib/api/endpoints";
import type { EventReport } from "@/lib/api/types";
import { fmtAge, fmtDateTime, fmtDistance, fmtDuration, fmtNumber, fmtPercent } from "@/lib/format";
import { EmptyState, ErrorState, Loading, Panel } from "@/components/common";
import { SimBadge } from "@/components/status";
import { useEventContext } from "@/features/events/context";

/** Only renders numbers present in the server report — nothing is computed or invented client-side. */
export default function EventReportPage() {
  const { t, locale } = useI18n();
  const { event } = useEventContext();
  const report = useQuery({ queryKey: ["app", "report", event.id], queryFn: () => eventsApi.report(event.id) });
  if (report.isLoading) return <Loading />;
  if (report.error || !report.data) return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  const r = report.data;

  return (
    <div className="space-y-6">
      <p className="text-caption text-fg-muted telemetry">{t("report.generated", { time: fmtDateTime(r.generated_at, locale) })}</p>
      <Counters title={t("report.members")} items={[
        [t("role.pilot"), r.members?.pilot],
        [t("role.observer"), r.members?.observer],
        [t("role.retriever"), r.members?.retriever],
        [t("role.organizer"), r.members?.organizers],
      ]} />
      <Counters title={t("report.flights")} items={[
        [t("report.flightCount"), r.flights?.count],
        [t("report.simulated"), r.flights?.simulated],
        [t("report.totalDuration"), r.flights?.total_duration_s, fmtDuration],
        [t("report.avgDuration"), r.flights?.avg_duration_s, fmtDuration],
        [t("report.completeness"), r.telemetry?.completeness, (v) => fmtPercent(v, locale)],
        [t("report.interruptions"), r.telemetry?.interruptions],
      ]} />
      <RetrievalSection r={r} />
      <PerFlight r={r} />
      <details className="rounded-lg border border-border bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-footnote font-medium text-fg-secondary">{t("report.raw")}</summary>
        <pre className="telemetry max-h-96 overflow-auto border-t border-border p-4 text-caption">{JSON.stringify(r, null, 2)}</pre>
      </details>
    </div>
  );
}

type Item = [string, number | null | undefined, ((v: number) => string)?];

function Counters({ title, items }: { title: string; items: Item[] }) {
  const { locale } = useI18n();
  const shown = items.filter(([, v]) => typeof v === "number");
  if (shown.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-footnote font-semibold tracking-wide text-fg-secondary uppercase">{title}</h2>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3 xl:grid-cols-6">
        {shown.map(([label, v, f]) => (
          <div key={label} className="bg-surface p-4">
            <div className="text-caption text-fg-muted">{label}</div>
            <div className="telemetry mt-1 text-title3">{f ? f(v as number) : fmtNumber(v, locale)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RetrievalSection({ r }: { r: EventReport }) {
  const { t, lang, locale } = useI18n();
  const ret = r.retrievals;
  if (!ret) return null;
  const age = (v: number) => fmtAge(v, lang);
  const statuses = Object.entries(ret.by_status ?? {}).filter(([, n]) => typeof n === "number");
  return (
    <section className="space-y-3">
      <Counters title={t("report.retrievals")} items={[
        [t("report.retrievalCount"), ret.count],
        [t("report.medianAccept"), ret.median_request_to_accept_s, age],
        [t("report.medianPickup"), ret.median_accept_to_pickup_s, age],
        [t("report.medianDelivery"), ret.median_pickup_to_delivery_s, age],
      ]} />
      {statuses.length > 0 && (
        <p className="text-footnote text-fg-secondary tnum">
          {statuses.map(([s, n]) => `${t(`retrieval.status.${s as keyof NonNullable<typeof ret.by_status>}`)} ${fmtNumber(n, locale)}`).join(" · ")}
        </p>
      )}
      {ret.count === 0 && <p className="text-footnote text-fg-muted">{t("report.noRetrievals")}</p>}
    </section>
  );
}

function PerFlight({ r }: { r: EventReport }) {
  const { t, locale } = useI18n();
  const items = r.items ?? [];
  if (items.length === 0) return <EmptyState title={t("report.noFlights")} />;
  const byPilot = new Map<string, number>();
  for (const f of items) byPilot.set(f.pilot_name, (byPilot.get(f.pilot_name) ?? 0) + f.duration_s / 60);
  const chart = [...byPilot.entries()].map(([name, minutes]) => ({ name, minutes: Math.round(minutes) })).sort((a, b) => b.minutes - a.minutes);
  return (
    <>
      <Panel title={t("report.durationPerPilot")}>
        <div className="h-64" role="img" aria-label={t("report.durationPerPilot")}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid vertical={false} stroke="rgb(var(--rf-border))" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "rgb(var(--rf-text-muted))" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "rgb(var(--rf-text-muted))" }} tickLine={false} axisLine={false} unit={` ${t("report.min")}`} width={56} />
              <Tooltip cursor={{ fill: "rgb(var(--rf-text-primary) / 0.05)" }} contentStyle={{ background: "rgb(var(--rf-surface-elevated))", border: "1px solid rgb(var(--rf-border))", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="minutes" fill="rgb(var(--rf-primary))" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <Panel title={t("report.perFlight")} bodyClassName="p-0 overflow-x-auto">
        <table className="w-full text-footnote">
          <thead className="text-left text-caption text-fg-muted">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium">{t("role.pilot")}</th>
              <th className="px-4 py-2 font-medium">{t("report.duration")}</th>
              <th className="px-4 py-2 font-medium">{t("report.distance")}</th>
              <th className="px-4 py-2 font-medium">{t("report.completeness")}</th>
              <th className="px-4 py-2 font-medium">{t("report.interruptions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tnum">
            {items.map((f) => (
              <tr key={f.flight_id}>
                <td className="px-4 py-2"><span className="inline-flex items-center gap-1.5">{f.pilot_name}{f.is_simulated && <SimBadge />}</span></td>
                <td className="telemetry px-4 py-2">{fmtDuration(f.duration_s)}</td>
                <td className="telemetry px-4 py-2">{fmtDistance(f.distance_m, locale)}</td>
                <td className="telemetry px-4 py-2">{fmtPercent(f.telemetry_completeness, locale)}</td>
                <td className="telemetry px-4 py-2">{f.interruptions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
