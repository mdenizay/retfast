import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { MailCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { authApi } from "@/lib/api/endpoints";
import { AuthLayout } from "@/layouts/PublicLayout";
import { Field, FormError } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.forgot(email.trim());
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-title2 font-semibold tracking-tight">{t("auth.forgotTitle")}</h1>
      {sent ? (
        <div role="status" className="mt-6 flex gap-3 rounded-md border border-border bg-surface p-4 text-footnote">
          <MailCheck className="size-5 shrink-0 text-primary" aria-hidden />
          <span>{t("auth.forgotSent")}</span>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
          <p className="text-footnote text-fg-secondary">{t("auth.forgotLead")}</p>
          <Field id="email" label={t("auth.email")}>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <FormError error={error} />
          <Button type="submit" size="lg" disabled={busy || !email}>{busy ? t("common.wait") : t("auth.sendLink")}</Button>
        </form>
      )}
      <div className="mt-6 text-footnote"><Link to="/login" className="text-fg underline decoration-fg/25 underline-offset-4 transition-colors hover:decoration-fg">{t("auth.backToLogin")}</Link></div>
    </AuthLayout>
  );
}
