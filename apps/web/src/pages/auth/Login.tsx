import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useI18n } from "@/lib/i18n";
import { login } from "@/lib/auth";
import { isApiError } from "@/lib/api/client";
import { AuthLayout } from "@/layouts/PublicLayout";
import { RedirectIfAuthed, safeNext } from "@/layouts/guards";
import { Field, FormError } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  return (
    <RedirectIfAuthed>
      <LoginForm />
    </RedirectIfAuthed>
  );
}

function LoginForm() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [retryIn, setRetryIn] = useState(0);

  useEffect(() => {
    if (retryIn <= 0) return;
    const id = setTimeout(() => setRetryIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [retryIn]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await login(email.trim(), password);
      const next = safeNext(params.get("next"));
      if (res.user.must_change_password) navigate(`/change-password?next=${encodeURIComponent(next)}`, { replace: true });
      else navigate(next, { replace: true });
    } catch (err) {
      setError(err);
      if (isApiError(err) && err.code === "rate_limited") setRetryIn(err.retryAfter ?? 60);
    } finally {
      setBusy(false);
    }
  }

  const invalidCreds = isApiError(error) && (error.status === 401 || error.code === "unauthorized");
  const rateLimited = isApiError(error) && error.code === "rate_limited";

  return (
    <AuthLayout>
      <h1 className="text-title2 font-semibold tracking-tight">{t("auth.login")}</h1>
      <p className="mt-1 text-footnote text-fg-secondary">{t("auth.loginLead")}</p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4" noValidate>
        <Field id="email" label={t("auth.email")}>
          <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="password" label={t("auth.password")}>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {invalidCreds ? (
          <div role="alert" className="rounded-md border border-error/40 bg-error/5 px-3 py-2.5 text-footnote">{t("auth.invalidCredentials")}</div>
        ) : rateLimited ? (
          <div role="alert" className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2.5 text-footnote">
            {t("auth.rateLimited", { s: retryIn })}
          </div>
        ) : (
          <FormError error={error} />
        )}
        <Button type="submit" size="lg" disabled={busy || !email || !password || retryIn > 0}>
          {busy ? t("common.wait") : t("auth.login")}
        </Button>
      </form>
      <div className="mt-6 flex justify-between text-footnote">
        <Link to="/forgot-password" className="text-primary hover:underline">{t("auth.forgot")}</Link>
        <Link to="/register" className="text-primary hover:underline">{t("auth.register")}</Link>
      </div>
    </AuthLayout>
  );
}
