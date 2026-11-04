import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useI18n } from "@/lib/i18n";
import { session } from "@/lib/auth";
import { authApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/client";
import { AuthLayout } from "@/layouts/PublicLayout";
import { RedirectIfAuthed } from "@/layouts/guards";
import { Field, FormError } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function RegisterPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: "", email: "", password: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const details = isApiError(error) ? error.details : {};

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password.length < 10) {
      setError(new Error("policy"));
      return;
    }
    setBusy(true);
    try {
      const res = await authApi.register(form.email.trim(), form.password, form.full_name.trim());
      session.setAuth(res);
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const policyErr = error instanceof Error && error.message === "policy" ? t("auth.passwordPolicy") : null;

  return (
    <RedirectIfAuthed>
      <AuthLayout>
        <h1 className="text-title2 font-semibold tracking-tight">{t("auth.register")}</h1>
        <p className="mt-1 text-footnote text-fg-secondary">{t("auth.registerLead")}</p>
        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4" noValidate>
          <Field id="full_name" label={t("auth.fullName")} error={details.full_name}>
            <Input id="full_name" autoComplete="name" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </Field>
          <Field id="email" label={t("auth.email")} error={details.email}>
            <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field id="password" label={t("auth.password")} hint={t("auth.passwordPolicy")} error={details.password ?? policyErr}>
            <Input id="password" type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          {!policyErr && <FormError error={error} />}
          <Button type="submit" size="lg" disabled={busy || !form.email || !form.password || !form.full_name}>
            {busy ? t("common.wait") : t("auth.createAccount")}
          </Button>
          <p className="text-caption text-fg-muted">
            {t("auth.registerPrivacy")} <Link to="/privacy" className="text-primary hover:underline">{t("nav.privacy")}</Link>
          </p>
        </form>
        <div className="mt-6 text-footnote">
          {t("auth.haveAccount")} <Link to="/login" className="text-primary hover:underline">{t("auth.login")}</Link>
        </div>
      </AuthLayout>
    </RedirectIfAuthed>
  );
}
