import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { eventsApi } from "@/lib/api/endpoints";
import type { EventReport } from "@/lib/api/types";
import { hasRole, useSession } from "@/lib/auth";
import { fmtAltitude, fmtDateTime, fmtDistance, fmtDuration, fmtNumber, fmtPercent } from "@/lib/format";
import { FlightStatusBadge, SimBadge } from "@/components/status";
import { EmptyState, ErrorState, Loading, PageHeader, Panel } from "@/components/common";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function ReportsPage() {
  const { t } = useI18n();
  const { user } = useSession();
  const admin = hasRole(user, "platform_admin");
  const events = useQuery({ queryKey: ["app", "events", "reports"], queryFn: () => eventsApi.list({ limit: 200 }) });
  const manageable = (events.data?.items ?? []).filter((e) => admin || e.my_role === "organizer");
  const [eventId, setEventId] = useState<string>("");
  const selected = eventId || manageable[0]?.id || "";
  const report = useQuery({ queryKey: ["app", "report", selected], queryFn: () => eventsApi.report(selected), enabled: Boolean(selected) });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav.reports")}
        subtitle={t("reports.lead")}
        actions={manageable.length > 0 && (
          <Select value={selected} onValueChange={setEventId}>
            <SelectTrigger className="w-72" aria-label={t("reports.event")}><SelectValue placeholder={t("reports.event")} /></SelectTrigger>
            <SelectContent>{manageable.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
      />
      {events.isLoading ? <Loading /> : events.error ? <ErrorState error={events.error} /> : manageable.length === 0 ? (
        <EmptyState icon={<BarChart3 className="size-6" />} title={t("reports.noEvents")} body={t("reports.noEventsBody")} />
      ) : report.isLoading ? <Loading /> : report.error ? <ErrorState error={report.error} onRetry={() => void report.refetch()} /> : report.data ? (
        <ReportView report={report.data} />
      ) : null}
    </div>
  );
}

function ReportView({ report: r }: { report: EventReport }) {
  const { t, locale } = useI18n();
  const items = r.items ?? [];
  const tiles: [string, string][] = [
    [t("reports.participants"), fmtNumber(r.participation?.participants, locale)],
    [t("reports.pilotsFlown"), fmtNumber(r.participation?.pilots_flown, locale)],
    [t("reports.flights"), fmtNumber(r.flights?.count, locale)],
    [t("reports.simulated"), fmtNumber(items.filter((f) => f.is_simulated).length, locale)],
    [t("reports.totalDuration"), fmtDuration(r.flights?.total_duration_s)],
    [t("reports.avgDuration"), fmtDuration(r.flights?.count ? r.flights.avg_duration_s : null)],
    [t("reports.totalDistance"), fmtDistance(items.reduce((a, f) => a + (f.distance_m ?? 0), 0), locale)],
    [t("flight.completeness"), fmtPercent(r.telemetry?.completeness, locale)],
    [t("reports.samples"), `${fmtNumber(r.telemetry?.samples, locale)} / ${fmtNumber(r.telemetry?.expected_samples, locale)}`],
    [t("reports.interruptions"), fmtNumber(r.telemetry?.interruptions, locale)],
  ];
  // Flight time per pilot (sum of that pilot's flights) — only charted when there is something to compare.
  const perPilot = Object.values(
    items.reduce<Record<string, { name: string; minutes: number }>>((acc, f) => {
      const cur = acc[f.pilot_id] ?? { name: f.pilot_name, minutes: 0 };
      cur.minutes += (f.duration_s ?? 0) / 60;
      acc[f.pilot_id] = cur;
      return acc;
    }, {}),
  )
    .map((p) => ({ ...p, minutes: Math.round(p.minutes) }))
    .filter((p) => p.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 20);
  const byStatus = Object.entries(r.flights?.by_status ?? {});

  return (
    <div className="space-y-6">
      <p className="text-caption text-fg-muted tnum">{t("reports.generated", { time: fmtDateTime(r.generated_at, locale) })}</p>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([k, v]) => (
          <div key={k} className="bg-surface p-4">
            <div className="text-caption text-fg-muted">{k}</div>
            <div className="telemetry mt-1 text-title3">{v}</div>
          </div>
        ))}
      </div>
      <p className="text-footnote text-fg-secondary tnum">
        {t("reports.organizers")}: {r.participation?.organizers ?? 0} · {t("reports.observers")}: {r.participation?.observers ?? 0} · {t("participants.removed")}: {r.participation?.removed ?? 0}
        {byStatus.length > 0 && <> · {t("reports.byStatus")}: {byStatus.map(([s, n]) => `${t(`flight.status.${s as "ended"}`)} ${n}`).join(", ")}</>}
      </p>
      {r.telemetry?.note && <p className="text-caption text-fg-muted">{r.telemetry.note}</p>}

      {perPilot.length > 1 && (
        <Panel title={`${t("reports.durationPerPilot")} · ${t("reports.minutes")}`}>
          <div style={{ height: Math.max(160, perPilot.length * 28 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perPilot} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={4}>
                <CartesianGrid horizontal={false} stroke="var(--color-border)" />
                <XAxis type="number" tick={{ fill: "var(--color-fg-muted)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--color-border)" }} />
                <YAxis type="category" dataKey="name" width={150} tick={{ fill: "var(--color-fg-secondary)", fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: "var(--color-accent)" }} contentStyle={{ background: "var(--color-surface-elevated)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 13 }} itemStyle={{ color: "var(--color-fg)" }} formatter={(v) => [`${v} ${t("reports.minutes")}`, ""]} separator="" />
                <Bar dataKey="minutes" fill="var(--color-primary)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      <Panel title={t("reports.perFlight")} bodyClassName="p-0">
        {items.length === 0 ? (
          <p className="p-4 text-footnote text-fg-muted">{t("reports.noFlights")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-footnote">
              <thead className="text-left text-caption text-fg-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium">{t("flights.pilot")}</th>
                  <th className="px-4 py-2 font-medium">{t("flights.status")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("flight.duration")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("flight.distance")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("flight.maxAlt")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("flight.completeness")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("reports.interruptions")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((f) => (
                  <tr key={f.flight_id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5">
                      <Link to={`/app/flights/${f.flight_id}`} className="font-medium hover:underline">{f.pilot_name}</Link>
                      {f.is_simulated && <span className="ml-2"><SimBadge /></span>}
                    </td>
                    <td className="px-4 py-2.5"><FlightStatusBadge status={f.status} /></td>
                    <td className="telemetry px-4 py-2.5 text-right">{fmtDuration(f.duration_s)}</td>
                    <td className="telemetry px-4 py-2.5 text-right">{fmtDistance(f.distance_m, locale)}</td>
                    <td className="telemetry px-4 py-2.5 text-right">{fmtAltitude(f.max_gps_alt_m, locale)}</td>
                    <td className="telemetry px-4 py-2.5 text-right">{fmtPercent(f.telemetry_completeness, locale)}</td>
                    <td className="telemetry px-4 py-2.5 text-right">{fmtNumber(f.interruptions, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
