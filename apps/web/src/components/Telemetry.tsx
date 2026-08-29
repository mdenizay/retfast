import { cardinal } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Reusable telemetry readouts for the ops console. Every widget degrades to a
 * clear "—" when the value is missing, so a stale pilot never looks healthy.
 */

/** Compass dial with a needle pointing at the reported course. */
export function HeadingDial({
  deg,
  size = 56,
  className,
}: {
  deg: number | null | undefined;
  size?: number;
  className?: string;
}) {
  const has = deg != null && Number.isFinite(deg);
  const angle = has ? ((deg! % 360) + 360) % 360 : 0;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0">
        <circle cx="50" cy="50" r="46" className="fill-muted stroke-border" strokeWidth="3" />
        {[0, 90, 180, 270].map((t) => (
          <line
            key={t}
            x1="50"
            y1="8"
            x2="50"
            y2="16"
            className="stroke-muted-foreground"
            strokeWidth="3"
            transform={`rotate(${t} 50 50)`}
          />
        ))}
        <text x="50" y="24" textAnchor="middle" className="fill-muted-foreground" fontSize="14">
          N
        </text>
        {has && (
          <g transform={`rotate(${angle} 50 50)`}>
            <path d="M50 16 L60 62 L50 54 L40 62 Z" className="fill-primary" />
          </g>
        )}
        {!has && (
          <text x="50" y="60" textAnchor="middle" className="fill-muted-foreground" fontSize="26">
            —
          </text>
        )}
      </svg>
      <div className="leading-tight">
        <div className="font-mono text-lg font-semibold tabular-nums">
          {has ? `${Math.round(angle)}°` : "—"}
        </div>
        <div className="text-xs text-muted-foreground">{cardinal(deg)}</div>
      </div>
      <span className="sr-only">{has ? `${Math.round(angle)} degrees ${cardinal(deg)}` : "no heading"}</span>
    </div>
  );
}

/** Battery pill: fill level + color banding (green / amber / red). */
export function BatteryGauge({
  pct,
  className,
}: {
  pct: number | null | undefined;
  className?: string;
}) {
  const has = pct != null && Number.isFinite(pct);
  const v = has ? Math.max(0, Math.min(100, pct!)) : 0;
  const tone = !has
    ? "bg-muted-foreground/40"
    : v <= 15
      ? "bg-red-500"
      : v <= 30
        ? "bg-amber-500"
        : "bg-green-500";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative h-4 w-9 rounded-[3px] border-2 border-foreground/70">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-[1px] transition-[width]", tone)}
          style={{ width: `${v}%` }}
        />
      </div>
      <div className="h-2 w-[3px] -ml-[7px] rounded-r bg-foreground/70" />
      <span className="font-mono text-sm font-semibold tabular-nums">
        {has ? `${Math.round(v)}%` : "—"}
      </span>
    </div>
  );
}

/** Labelled value block used across the detail sheets. */
export function Stat({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn" | "danger";
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card px-3 py-2", className)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "font-mono text-lg font-semibold tabular-nums leading-tight",
          tone === "warn" && "text-amber-600",
          tone === "danger" && "text-red-600",
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Green / amber / red dot describing how fresh a position fix is. */
export function FreshnessDot({ ageSec, className }: { ageSec: number | null; className?: string }) {
  const tone =
    ageSec == null
      ? "bg-muted-foreground/50"
      : ageSec < 60
        ? "bg-green-500"
        : ageSec < 300
          ? "bg-amber-500"
          : "bg-red-500";
  const pulse = ageSec != null && ageSec < 60;
  return (
    <span className={cn("relative inline-flex size-2.5 shrink-0", className)}>
      {pulse && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-60" />
      )}
      <span className={cn("relative inline-flex size-2.5 rounded-full", tone)} />
    </span>
  );
}
