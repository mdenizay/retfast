import { Badge } from "@/components/ui/badge";
import { FreshnessDot } from "@/components/Telemetry";
import { useI18n } from "@/i18n";
import { ageSeconds, fmtAgo, fmtAltitude, fmtHeading, fmtSpeed } from "@/lib/format";
import type { PilotLive, RetrieverLive } from "@/lib/useOpsLive";

/**
 * Roster rows shared by the full-page ops console and the compact event tab.
 * Each row surfaces the four numbers an observer actually watches — altitude,
 * speed, heading, battery — plus fix freshness.
 */

export function PilotRow({
  pilot,
  active,
  onClick,
}: {
  pilot: PilotLive;
  active?: boolean;
  onClick?: () => void;
}) {
  const { m, locale } = useI18n();
  const fix = pilot.fix;
  const lowBattery = (fix?.battery_pct ?? 100) <= 20;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-3.5 text-left shadow-sm transition-all ${
        active ? "border-primary/55 bg-primary/10 shadow-primary/5" : "border-white/8 bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.05]"
      }`}
    >
      <div className="flex items-center gap-2">
        <FreshnessDot ageSec={ageSeconds(fix?.recorded_at)} />
        <span className="truncate text-sm font-medium">{pilot.name}</span>
        <Badge
          variant={pilot.task.status === "landed" ? "secondary" : "default"}
          className="ml-auto shrink-0"
        >
          {m.flights.statuses[pilot.task.status]}
        </Badge>
      </div>

      {fix ? (
        <>
          <div className="mt-3 grid grid-cols-4 gap-1.5 rounded-xl bg-black/20 p-2">
            <Cell label={m.ops.altitude} value={fmtAltitude(fix.altitude_m)} />
            <Cell label={m.ops.speed} value={fmtSpeed(fix.speed_mps)} />
            <Cell label={m.ops.heading} value={fmtHeading(fix.heading_deg)} />
            <Cell
              label={m.ops.battery}
              value={fix.battery_pct != null ? `${fix.battery_pct}%` : "—"}
              danger={lowBattery}
            />
          </div>
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            {m.ops.lastFix}: {fmtAgo(fix.recorded_at, locale)}
          </div>
        </>
      ) : (
        <div className="mt-1.5 text-[11px] text-muted-foreground">{m.ops.noSignal}</div>
      )}
    </button>
  );
}

function Cell({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`truncate font-mono text-xs font-semibold tabular-nums ${
          danger ? "text-red-500" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

export function RetrieverRow({
  retriever,
  active,
  onClick,
}: {
  retriever: RetrieverLive;
  active?: boolean;
  onClick?: () => void;
}) {
  const { m, locale } = useI18n();
  const free = retriever.vehicle_capacity - retriever.occupied_seats;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-3.5 text-left shadow-sm transition-all ${
        active ? "border-primary/55 bg-primary/10 shadow-primary/5" : "border-white/8 bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.05]"
      }`}
    >
      <div className="flex items-center gap-2">
        <FreshnessDot ageSec={ageSeconds(retriever.last_seen_at)} />
        <span className="truncate text-sm font-medium">{retriever.name}</span>
        <span className="ml-auto shrink-0 font-mono text-xs font-semibold tabular-nums">
          {retriever.occupied_seats}/{retriever.vehicle_capacity}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{m.ops[retriever.availability]}</span>
        <span>· {free} {m.ops.seats}</span>
        <span className="ml-auto">
          {retriever.last_seen_at ? fmtAgo(retriever.last_seen_at, locale) : m.ops.noSignal}
        </span>
      </div>
      {retriever.vehicle_description && (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {retriever.vehicle_description}
        </div>
      )}
    </button>
  );
}
