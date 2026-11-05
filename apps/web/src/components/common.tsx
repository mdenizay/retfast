import type { ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, Inbox, Loader2, Lock } from "lucide-react";
import { isApiError } from "@/lib/api/client";
import { useI18n, type TFunction } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-footnote font-medium text-fg-muted">{eyebrow}</div>}
        <h1 className="text-title1 font-semibold tracking-[-0.02em] text-fg sm:text-[34px] sm:leading-[40px]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-body text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Section title with an optional count and a trailing action ("View all" pill). */
export function SectionTitle({ title, count, action, id, className }: { title: ReactNode; count?: number; action?: ReactNode; id?: string; className?: string }) {
  return (
    <div className={cn("flex min-h-9 items-center justify-between gap-3", className)}>
      <h2 id={id} className="flex items-baseline gap-2 text-headline font-semibold tracking-tight text-fg">
        {title}
        {typeof count === "number" && <span className="text-body font-medium text-fg-muted tnum">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

/** Accent pill link used for "View all" style actions. */
export function PillLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex h-8 items-center rounded-full bg-brand/12 px-3.5 text-footnote font-semibold text-brand transition-colors hover:bg-brand/20">
      {children}
    </Link>
  );
}

/** Large-radius card on the page background. No border; contrast comes from the surface tone. */
export function Panel({ title, actions, children, className, bodyClassName, count }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; count?: number }) {
  return (
    <section className={cn("min-w-0 rounded-3xl bg-surface", className)}>
      {(title || actions) && (
        <div className="flex min-h-14 items-center justify-between gap-3 px-5 pt-5">
          {title && (
            <h2 className="flex items-baseline gap-2 text-headline font-semibold tracking-tight text-fg">
              {title}
              {typeof count === "number" && <span className="text-body font-medium text-fg-muted tnum">{count}</span>}
            </h2>
          )}
          {actions}
        </div>
      )}
      <div className={cn("px-5 pt-3 pb-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Inner tile: big number, small muted label underneath. */
export function StatTile({ label, value, icon, tone, className }: { label: ReactNode; value: ReactNode; icon?: ReactNode; tone?: "brand" | "retrieval" | "warning" | "success"; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col justify-between gap-3 rounded-2xl bg-muted p-4", className)}>
      {icon && (
        <span
          className={cn(
            "grid size-8 place-items-center rounded-full bg-fg/8 text-fg-secondary [&_svg]:size-4",
            tone === "brand" && "bg-brand/15 text-brand",
            tone === "retrieval" && "bg-retrieval/15 text-retrieval",
            tone === "warning" && "bg-warning/15 text-warning",
            tone === "success" && "bg-success/15 text-success",
          )}
          aria-hidden
        >
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <div className="truncate text-title1 font-semibold tracking-tight text-fg tnum">{value}</div>
        <div className="mt-0.5 truncate text-footnote text-fg-muted">{label}</div>
      </div>
    </div>
  );
}

export function Stat({ label, value, hint, mono = true }: { label: ReactNode; value: ReactNode; hint?: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl bg-muted px-3.5 py-3">
      <div className={cn("truncate text-headline font-semibold text-fg", mono && "tnum")}>{value}</div>
      <div className="mt-0.5 text-caption text-fg-muted">{label}</div>
      {hint && <div className="text-caption text-fg-muted">{hint}</div>}
    </div>
  );
}

/** Day-activity grid of rounded squares (accent = active). `days` is oldest → newest. */
export function Heatmap({ days, label, columns = 14 }: { days: { key: string; value: number; title: string }[]; label: string; columns?: number }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <div role="img" aria-label={label} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {days.map((d) => (
        <span
          key={d.key}
          title={d.title}
          className={cn("aspect-square rounded-[6px]", d.value === 0 ? "bg-fg/8" : "bg-primary")}
          style={d.value === 0 ? undefined : { opacity: 0.45 + 0.55 * (d.value / max) }}
        />
      ))}
    </div>
  );
}

export function Loading({ label, className }: { label?: string; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cn("flex items-center gap-2 py-10 text-footnote text-fg-muted", className)} role="status" aria-live="polite">
      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      {label ?? t("common.loading")}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: ReactNode; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-3xl bg-surface px-6 py-14 text-center">
      <div className="mb-2 grid size-14 place-items-center rounded-full bg-muted text-fg-muted" aria-hidden>{icon ?? <Inbox className="size-5" />}</div>
      <div className="text-headline font-medium text-fg">{title}</div>
      {body && <p className="max-w-md text-footnote text-fg-secondary">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function errorMessage(err: unknown, t: TFunction): string {
  if (isApiError(err)) {
    if (err.code === "rate_limited") return t("error.rateLimited", { s: err.retryAfter ?? 60 });
    if (err.code === "forbidden") return t("error.forbidden");
    if (err.code === "not_found") return t("error.notFound");
    if (err.code === "unavailable" || err.status === 503) return t("error.unavailable");
    if (err.code === "internal" || err.status >= 500) return t("error.internal");
    if (err.code === "unauthorized" || err.code === "token_expired") return t("error.unauthorized");
    return err.message || t("error.generic");
  }
  if (err instanceof TypeError) return t("error.network");
  return t("error.generic");
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const { t } = useI18n();
  const forbidden = isApiError(error) && (error.code === "forbidden" || error.status === 403);
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-2xl bg-error/10 p-4", className)}>
      {forbidden ? <Lock className="mt-0.5 size-5 shrink-0 text-error" aria-hidden /> : <AlertTriangle className="mt-0.5 size-5 shrink-0 text-error" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="text-body font-medium text-fg">{errorMessage(error, t)}</div>
        {isApiError(error) && (
          <div className="mt-1 telemetry text-caption text-fg-muted">
            {error.status} · {error.code}
            {error.requestId ? ` · ${error.requestId}` : ""}
          </div>
        )}
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="text-footnote font-semibold text-brand underline-offset-4 transition-colors hover:underline">
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

/** Inline form error (server message or field details). */
export function FormError({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl bg-error/10 px-4 py-3 text-footnote text-fg">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
      <span>{errorMessage(error, t)}</span>
    </div>
  );
}

export function Field({ id, label, hint, error, children, className }: { id: string; label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-caption text-error">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-caption text-fg-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function KeyValue({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-footnote", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="min-w-0 truncate text-right text-fg tnum">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-headline font-semibold tracking-tight text-fg", className)}>
      <span className="grid size-8 place-items-center rounded-full bg-primary text-on-primary" aria-hidden>
        <svg viewBox="0 0 32 32" className="size-[18px]">
          <path fillRule="evenodd" d="M16 5.1 24.7 26.6 16 22 7.3 26.6Zm0 5.5-3.9 9.7 3.9-2.05 3.9 2.05Z" fill="currentColor" />
        </svg>
      </span>
      <span>Retfast</span>
    </span>
  );
}

function initials(name?: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toLocaleUpperCase() || "R";
}

/** Round initials avatar. `accent` uses the brand fill (the signed-in user); others get a neutral tint. */
export function NameAvatar({ name, accent, className }: { name?: string | null; accent?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-full text-footnote font-semibold",
        accent ? "bg-primary text-on-primary" : "bg-muted text-fg-secondary",
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
