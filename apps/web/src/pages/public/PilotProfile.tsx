import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { pilotsApi } from "@/lib/api/endpoints";
import { ErrorState, KeyValue, Loading } from "@/components/common";

export default function PilotProfilePage() {
  const { publicId = "" } = useParams();
  const { t } = useI18n();
  const q = useQuery({ queryKey: ["public", "pilot", publicId], queryFn: () => pilotsApi.publicProfile(publicId) });
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      {q.isLoading ? <Loading /> : q.error || !q.data ? <ErrorState error={q.error} /> : (
        <>
          <div className="flex items-center gap-4">
            <div className="grid size-14 place-items-center rounded-full border border-border bg-surface"><UserRound className="size-6 text-fg-muted" aria-hidden /></div>
            <div>
              <h1 className="text-title2 font-semibold tracking-tight">{q.data.display_name}</h1>
              <div className="telemetry text-footnote text-fg-muted">@{q.data.public_id}</div>
            </div>
          </div>
          {q.data.bio && <p className="mt-6 whitespace-pre-line text-body text-fg-secondary">{q.data.bio}</p>}
          <div className="mt-8 rounded-lg border border-border bg-surface p-4">
            <KeyValue items={[[t("pilot.wing"), q.data.wing || "—"], [t("pilot.nationality"), q.data.nationality || "—"]]} />
          </div>
          <p className="mt-4 text-caption text-fg-muted">{t("pilot.publicNote")}</p>
        </>
      )}
    </div>
  );
}
