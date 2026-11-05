import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { authApi } from "@/lib/api/endpoints";
import { AuthLayout } from "@/layouts/PublicLayout";
import { ErrorState, Loading } from "@/components/common";

export default function VerifyEmailPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"pending" | "ok" | { error: unknown }>("pending");
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    authApi.verifyEmail(token).then(
      () => setState("ok"),
      (error) => setState({ error }),
    );
  }, [token]);

  return (
    <AuthLayout>
      <h1 className="text-title2 font-semibold tracking-tight">{t("auth.verifyTitle")}</h1>
      <div className="mt-6">
        {!token ? (
          <p role="alert" className="text-footnote text-error">{t("auth.tokenMissing")}</p>
        ) : state === "pending" ? (
          <Loading label={t("auth.verifying")} />
        ) : state === "ok" ? (
          <div role="status" className="flex gap-3 rounded-md border border-border bg-surface p-4 text-footnote">
            <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
            <span>{t("auth.verified")}</span>
          </div>
        ) : (
          <ErrorState error={state.error} />
        )}
      </div>
      <div className="mt-6 text-footnote"><Link to="/app" className="text-fg underline decoration-fg/25 underline-offset-4 transition-colors hover:decoration-fg">{t("nav.openApp")}</Link></div>
    </AuthLayout>
  );
}
