import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { KeyRound } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { logout, session, useSession } from "@/lib/auth";
import { authApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/client";
import { AuthLayout } from "@/layouts/PublicLayout";
import { FullScreenLoading, safeNext } from "@/layouts/guards";
import { Field, FormError } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ChangePasswordPage() {
  const { t } = useI18n();
  const { status, user } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (status === "loading") return <FullScreenLoading />;
  if (status === "anonymous") return <Navigate to="/login?next=%2Fchange-password" replace />;

  const forced = Boolean(user?.must_change_password);
  const mismatch = pw2.length > 0 && pw !== pw2;
  const sameAsOld = pw.length > 0 && pw === current;
  const details = isApiError(error) ? error.details : {};

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pw !== pw2 || pw.length < 10 || sameAsOld) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.changePassword(current, pw);
      session.setAuth(res);
      navigate(safeNext(params.get("next")), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-title2 font-semibold tracking-tight">{t("auth.changeTitle")}</h1>
      {forced && (
        <div role="alert" className="mt-4 flex gap-3 rounded-md border border-warning/50 bg-warning/10 p-3 text-footnote text-fg">
          <KeyRound className="size-5 shrink-0 text-warning" aria-hidden />
          <span>{t("auth.forcedChange")}</span>
        </div>
      )}
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <Field id="current" label={t("auth.currentPassword")} error={details.current_password}>
          <Input id="current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field id="new" label={t("auth.newPassword")} hint={t("auth.passwordPolicy")} error={details.new_password ?? (sameAsOld ? t("auth.sameAsOld") : null)}>
          <Input id="new" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field id="new2" label={t("auth.confirmPassword")} error={mismatch ? t("auth.mismatch") : null}>
          <Input id="new2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-invalid={mismatch || undefined} />
        </Field>
        {!details.new_password && !details.current_password && <FormError error={error} />}
        <Button type="submit" size="lg" disabled={busy || !current || pw.length < 10 || pw !== pw2 || sameAsOld}>
          {busy ? t("common.wait") : t("auth.setPassword")}
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            await logout().catch(() => undefined);
            navigate("/login", { replace: true });
          }}
        >
          {t("auth.logout")}
        </Button>
      </form>
    </AuthLayout>
  );
}
