import { Link, useParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { FlightView } from "@/features/flights/FlightView";

export default function FlightDetailPage() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <Link to="/app/flights" className="inline-flex items-center gap-1 text-footnote text-fg-secondary hover:text-fg"><ArrowLeft className="size-4" aria-hidden />{t("flights.back")}</Link>
      <FlightView idOrPublicId={id} mode="app" />
    </div>
  );
}
