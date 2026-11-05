import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { eventsApi, type EventInput } from "@/lib/api/endpoints";
import { PageHeader } from "@/components/common";
import { EventForm } from "@/features/events/EventForm";

export default function EventNewPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (input: EventInput) => eventsApi.create(input),
    onSuccess: (ev) => {
      void qc.invalidateQueries({ queryKey: ["app", "events"] });
      navigate(`/app/events/${ev.id}/settings#organizers`, { replace: true, state: { created: true } });
    },
  });
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={t("events.new")} subtitle={t("eventForm.newLead")} />
      <EventForm onSubmit={(i) => create.mutate(i)} submitLabel={t("eventForm.create")} busy={create.isPending} error={create.error} />
    </div>
  );
}
