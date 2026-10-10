"use client";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-amber text-ink hover:brightness-110 font-semibold",
  secondary: "bg-raised text-ivory border border-amber/40 hover:border-amber",
  ghost: "text-muted hover:text-ivory hover:bg-raised",
  danger: "bg-danger text-white hover:brightness-110 font-semibold",
};

export function Button({ variant = "secondary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" };
  return (
    <button
      {...p}
      className={cx("inline-flex items-center justify-center gap-2 rounded-xl transition disabled:opacity-40 disabled:pointer-events-none", sizes[size], variants[variant], className)}
    />
  );
}

const field = "w-full rounded-xl bg-ink border border-line px-3 text-ivory placeholder:text-muted/60 focus:border-amber focus:outline-none";

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(field, "h-10", className)} />;
}

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx(field, "py-2 min-h-20", className)} />;
}

export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(field, "h-10", className)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted/70">{hint}</span>}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-2xl border border-line bg-surface", className)}>{children}</div>;
}

export function Badge({ tone = "default", children }: { tone?: "default" | "amber" | "ok" | "danger" | "sky"; children: ReactNode }) {
  const tones = {
    default: "bg-raised text-muted",
    amber: "bg-amber-soft text-amber",
    ok: "bg-ok/15 text-ok",
    danger: "bg-danger/15 text-danger",
    sky: "bg-sky/15 text-sky",
  };
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{children}</p>;
}

export function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-amber" />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}
