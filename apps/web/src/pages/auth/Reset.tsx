import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { authApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/client";
import { AuthLayout } from "@/layouts/PublicLayout";
import { Field, FormError } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = pw2.length > 0 && pw !== pw2;
  const details = isApiError(error) ? error.details : {};

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pw !== pw2 || pw.length < 10) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.reset(token, pw);
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-title2 font-semibold tracking-tight">{t("auth.resetTitle")}</h1>
      {!token ? (
        <p role="alert" className="mt-6 text-footnote text-error">{t("auth.tokenMissing")}</p>
      ) : done ? (
        <div role="status" className="mt-6 flex gap-3 rounded-2xl bg-muted p-4 text-footnote">
          <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
          <span>{t("auth.resetDone")}</span>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
          <Field id="pw" label={t("auth.newPassword")} hint={t("auth.passwordPolicy")} error={details.new_password}>
            <Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field id="pw2" label={t("auth.confirmPassword")} error={mismatch ? t("auth.mismatch") : null}>
            <Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-invalid={mismatch || undefined} />
          </Field>
          {!details.new_password && <FormError error={error} />}
          <Button type="submit" size="lg" disabled={busy || pw.length < 10 || pw !== pw2}>{busy ? t("common.wait") : t("auth.setPassword")}</Button>
        </form>
      )}
      <div className="mt-6 text-footnote"><Link to="/login" className="font-semibold text-brand underline-offset-4 transition-colors hover:underline">{t("auth.backToLogin")}</Link></div>
    </AuthLayout>
  );
}
