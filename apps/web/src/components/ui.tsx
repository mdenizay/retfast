"use client";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-amber text-ink hover:brightness-110 font-semibold",
  secondary: "bg-white/[0.07] text-ivory hover:bg-white/[0.12]",
  ghost: "text-muted hover:text-ivory hover:bg-white/[0.06]",
  danger: "bg-danger text-white hover:brightness-110 font-semibold",
};

export function Button({ variant = "secondary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-8 px-3.5 text-[13px]", md: "h-10 px-5 text-sm", lg: "h-12 px-7 text-[15px]" };
  return (
    <button
      {...p}
      className={cx("inline-flex items-center justify-center gap-2 rounded-full font-medium transition disabled:pointer-events-none disabled:opacity-40", sizes[size], variants[variant], className)}
    />
  );
}

const field = "w-full rounded-2xl border border-white/[0.07] bg-white/[0.04] px-4 text-ivory placeholder:text-muted/60 focus:border-amber/60 focus:bg-white/[0.06] focus:outline-none";

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(field, "h-11", className)} />;
}

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx(field, "min-h-24 py-3", className)} />;
}

export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(field, "h-11", className)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-[13px] text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted/70">{hint}</span>}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-[28px] border border-white/[0.06] bg-surface/90", className)}>{children}</div>;
}

export function Badge({ tone = "default", children }: { tone?: "default" | "amber" | "ok" | "danger" | "sky"; children: ReactNode }) {
  const tones = {
    default: "bg-white/[0.07] text-muted",
    amber: "bg-amber-soft text-amber",
    ok: "bg-ok/15 text-ok",
    danger: "bg-danger/15 text-danger",
    sky: "bg-sky/15 text-sky",
  };
  return <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", tones[tone])}>{children}</span>;
}

/** Hap biçimli sekme grubu. */
export function Pills<T extends string>({ value, options, onChange, className }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div className={cx("inline-flex gap-1 rounded-full bg-white/[0.04] p-1", className)}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cx("h-8 whitespace-nowrap rounded-full px-4 text-[13px] transition", value === o.value ? "bg-white/[0.12] text-ivory" : "text-muted hover:text-ivory")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">{children}</p>;
}

export function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/10 border-t-amber" />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted">{children}</p>;
}
