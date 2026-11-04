import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/lib/i18n";
import type { Position } from "@/lib/api/types";
import { fmtTime } from "@/lib/format";
import { Panel } from "@/components/common";
import { downsample } from "./quality";

interface Row {
  t: number;
  alt: number | null;
  speed: number | null;
}

/** Altitude and ground speed as two single-series charts (never a dual axis). */
export function FlightCharts({ positions }: { positions: Position[] }) {
  const { t } = useI18n();
  const rows = useMemo<Row[]>(
    () =>
      downsample(
        [...positions].sort((a, b) => a.seq - b.seq),
        1200,
      ).map((p) => ({ t: Date.parse(p.t), alt: p.gps_alt_m, speed: p.speed_ms == null ? null : p.speed_ms * 3.6 })),
    [positions],
  );
  const hasAlt = rows.some((r) => r.alt !== null);
  const hasSpeed = rows.some((r) => r.speed !== null);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title={`${t("flight.chartAlt")} · m`}>
        {hasAlt ? <SeriesChart rows={rows} dataKey="alt" unit="m" /> : <p className="text-footnote text-fg-muted">{t("flight.noAlt")}</p>}
      </Panel>
      <Panel title={`${t("flight.chartSpeed")} · km/h`}>
        {hasSpeed ? <SeriesChart rows={rows} dataKey="speed" unit="km/h" /> : <p className="text-footnote text-fg-muted">{t("flight.noSpeed")}</p>}
      </Panel>
    </div>
  );
}

function SeriesChart({ rows, dataKey, unit }: { rows: Row[]; dataKey: "alt" | "speed"; unit: string }) {
  const { locale } = useI18n();
  const spanMs = rows.length > 1 ? rows[rows.length - 1]!.t - rows[0]!.t : 0;
  const tickSeconds = spanMs < 15 * 60 * 1000;
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  return (
    <div className="h-56" role="img" aria-label={`${dataKey === "alt" ? "GPS" : ""} ${unit}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="0" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v: number) => fmtTime(v, locale, tickSeconds)}
            tick={{ fill: "var(--color-fg-muted)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-border)" }}
            minTickGap={48}
          />
          <YAxis
            width={48}
            tick={{ fill: "var(--color-fg-muted)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => nf.format(v)}
            domain={["auto", "auto"]}
          />
          <Tooltip
            cursor={{ stroke: "var(--color-fg-muted)", strokeWidth: 1 }}
            contentStyle={{ background: "var(--color-surface-elevated)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 13 }}
            labelStyle={{ color: "var(--color-fg-muted)" }}
            itemStyle={{ color: "var(--color-fg)" }}
            labelFormatter={(v) => fmtTime(Number(v), locale)}
            formatter={(v) => [`${nf.format(Number(v))} ${unit}`, ""]}
            separator=""
          />
          <Line type="linear" dataKey={dataKey} stroke="var(--color-primary)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
