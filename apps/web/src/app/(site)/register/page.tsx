"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Card, ErrorText, Field, Input } from "@/components/ui";
import { api, errorCode } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";

function RegisterForm() {
  const { t, err, locale } = useI18n();
  const { setUser } = useSession();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      const { user } = await api.auth.register({
        email: String(f.get("email")), password: String(f.get("password")),
        first_name: String(f.get("first_name")), last_name: String(f.get("last_name")), locale,
      });
      setUser(user);
      router.push(next?.startsWith("/") ? next : "/app");
    } catch (x) {
      setError(err(errorCode(x)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto mt-16 max-w-md p-6">
      <h1 className="text-2xl font-black tracking-tight">{t("auth.register_title")}</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("auth.first_name")}><Input name="first_name" autoComplete="given-name" required maxLength={80} /></Field>
          <Field label={t("auth.last_name")}><Input name="last_name" autoComplete="family-name" required maxLength={80} /></Field>
        </div>
        <Field label={t("auth.email")}><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label={t("auth.password")} hint={t("auth.password_hint")}>
          <Input name="password" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button variant="primary" size="lg" className="w-full" disabled={busy}>{t("nav.register")}</Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        {t("auth.have_account")} <Link className="text-amber" href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}>{t("nav.login")}</Link>
      </p>
    </Card>
  );
}

export default function RegisterPage() {
  return <main className="px-4"><Suspense><RegisterForm /></Suspense></main>;
}
