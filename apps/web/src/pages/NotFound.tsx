import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
      <div className="telemetry text-display text-fg-muted">404</div>
      <h1 className="text-title3 font-semibold">{t("error.pageNotFound")}</h1>
      <Button asChild variant="outline"><Link to="/">{t("common.home")}</Link></Button>
    </div>
  );
}

export function RouteErrorPage() {
  const err = useRouteError();
  const { t } = useI18n();
  if (isRouteErrorResponse(err) && err.status === 404) return <NotFoundPage />;
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
      <h1 className="text-title3 font-semibold">{t("error.crashTitle")}</h1>
      <p className="text-footnote text-fg-secondary">{t("error.crashBody")}</p>
      <Button variant="outline" onClick={() => window.location.reload()}>{t("common.reload")}</Button>
    </div>
  );
}
