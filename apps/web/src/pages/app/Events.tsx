import { Link } from "react-router";
import { Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { canCreateEvents, useSession } from "@/lib/auth";
import { PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { EventsList } from "@/pages/public/Events";

export default function AppEventsPage() {
  const { t } = useI18n();
  const { user } = useSession();
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("events.title")}
        subtitle={t("events.appLead")}
        actions={canCreateEvents(user) && <Button asChild><Link to="/app/events/new"><Plus /> {t("events.new")}</Link></Button>}
      />
      <EventsList basePath="/app/events" publicMode={false} />
    </div>
  );
}
