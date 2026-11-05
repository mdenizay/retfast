import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2, Lock } from "lucide-react";
import { isApiError } from "@/lib/api/client";
import { useI18n, type TFunction } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-caption font-semibold tracking-wide text-brand uppercase">{eyebrow}</div>}
        <h1 className="text-title2 font-semibold tracking-tight text-fg sm:text-title1">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-body text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-border bg-surface shadow-xs", className)}>
      {(title || actions) && (
        <div className="flex min-h-12 items-center justify-between gap-3 px-5 pt-4 pb-1">
          {title && <h2 className="text-callout font-semibold tracking-tight text-fg">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={cn("px-5 pt-3 pb-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, mono = true }: { label: ReactNode; value: ReactNode; hint?: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-caption text-fg-muted">{label}</div>
      <div className={cn("mt-0.5 truncate text-headline text-fg", mono && "telemetry")}>{value}</div>
      {hint && <div className="text-caption text-fg-muted">{hint}</div>}
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
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface/50 px-6 py-12 text-center">
      <div className="mb-1 grid size-11 place-items-center rounded-lg border border-border bg-surface text-fg-muted shadow-xs" aria-hidden>{icon ?? <Inbox className="size-5" />}</div>
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
    <div role="alert" className={cn("flex items-start gap-3 rounded-lg border border-error/40 bg-error/5 p-4", className)}>
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
        <button type="button" onClick={onRetry} className="text-footnote font-medium text-fg underline decoration-fg/25 underline-offset-4 transition-colors hover:decoration-fg">
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
    <div role="alert" className="flex items-start gap-2 rounded-md border border-error/40 bg-error/5 px-3 py-2.5 text-footnote text-fg">
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
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight text-fg", className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <defs>
          <linearGradient id="rf-sunset" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FB923C" />
            <stop offset="0.55" stopColor="#F97316" />
            <stop offset="1" stopColor="#E11D48" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="#111111" className="dark:stroke-white/15" strokeWidth="1" />
        <path fillRule="evenodd" d="M16 5.1 24.7 26.6 16 22 7.3 26.6Zm0 5.5-3.9 9.7 3.9-2.05 3.9 2.05Z" fill="url(#rf-sunset)" />
      </svg>
      <span>Retfast</span>
    </span>
  );
}
