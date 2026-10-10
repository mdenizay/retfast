"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Card, ErrorText, Field, Input } from "@/components/ui";
import { api, errorCode } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";

function LoginForm() {
  const { t, err } = useI18n();
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
      const { user } = await api.auth.login({ email: String(f.get("email")), password: String(f.get("password")) });
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
      <h1 className="text-2xl font-black tracking-tight">{t("auth.login_title")}</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label={t("auth.email")}><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label={t("auth.password")}><Input name="password" type="password" autoComplete="current-password" required /></Field>
        <ErrorText>{error}</ErrorText>
        <Button variant="primary" size="lg" className="w-full" disabled={busy}>{t("nav.login")}</Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        {t("auth.no_account")} <Link className="text-amber" href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`}>{t("nav.register")}</Link>
      </p>
    </Card>
  );
}

export default function LoginPage() {
  return <main className="px-4"><Suspense><LoginForm /></Suspense></main>;
}
