import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { Compass, TriangleAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-md px-4 py-20">
      <div className="flex flex-col items-center gap-4 rounded-3xl bg-surface px-6 py-10 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-brand/12 text-brand" aria-hidden><Compass className="size-7" /></span>
        <div className="text-[56px] leading-none font-semibold tracking-[-0.04em] text-fg tnum">404</div>
        <h1 className="text-headline font-semibold text-fg-secondary">{t("error.pageNotFound")}</h1>
        <Button asChild className="mt-2 w-full"><Link to="/">{t("common.home")}</Link></Button>
      </div>
    </div>
  );
}

export function RouteErrorPage() {
  const err = useRouteError();
  const { t } = useI18n();
  if (isRouteErrorResponse(err) && err.status === 404) return <NotFoundPage />;
  return (
    <div role="alert" className="mx-auto w-full max-w-md px-4 py-20">
      <div className="flex flex-col items-center gap-3 rounded-3xl bg-surface px-6 py-10 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-error/12 text-error" aria-hidden><TriangleAlert className="size-7" /></span>
        <h1 className="text-title3 font-semibold">{t("error.crashTitle")}</h1>
        <p className="text-footnote text-fg-secondary">{t("error.crashBody")}</p>
        <Button className="mt-2 w-full" onClick={() => window.location.reload()}>{t("common.reload")}</Button>
      </div>
    </div>
  );
}
