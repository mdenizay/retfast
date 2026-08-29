import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/auth/AuthProvider";
import { useI18n } from "@/i18n";
import { fmtDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { EventRole, EventRow } from "@/lib/types";
import MembersTab from "./MembersTab";
import RequestsTab from "./RequestsTab";
import ZonesTab from "./ZonesTab";
import OpsTab from "./OpsTab";
import FlightsTab from "./FlightsTab";
import AuditTab from "./AuditTab";
import SettingsTab from "./SettingsTab";

export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const { m, locale } = useI18n();
  const { profile, session } = useAuth();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [roles, setRoles] = useState<EventRole[]>([]);
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "ops";

  const load = useCallback(async () => {
    if (!id || !session) return;
    const [{ data: ev }, { data: mem }] = await Promise.all([
      supabase.from("events").select("*").eq("id", id).maybeSingle(),
      supabase.from("event_members").select("role").eq("event_id", id).eq("user_id", session.user.id),
    ]);
    setEvent((ev as EventRow | null) ?? null);
    setRoles(((mem ?? []) as { role: EventRole }[]).map((r) => r.role));
  }, [id, session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!event || !id) return <p className="text-muted-foreground">{m.common.loading}</p>;

  const isAdmin = profile?.is_system_admin || roles.includes("event_admin");
  const isOperator = isAdmin || roles.includes("observer");

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{event.name}</h1>
          {roles.map((r) => (
            <Badge key={r} variant="secondary">
              {m.roles[r]}
            </Badge>
          ))}
          {event.is_archived && <Badge variant="destructive">{m.events.archived}</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {fmtDateTime(event.starts_at, locale)} → {fmtDateTime(event.ends_at, locale)}
        </p>
        {event.description && <p className="mt-2 max-w-3xl text-sm">{event.description}</p>}
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="ops">{m.tabs.ops}</TabsTrigger>
          <TabsTrigger value="flights">{m.tabs.flights}</TabsTrigger>
          <TabsTrigger value="zones">{m.tabs.zones}</TabsTrigger>
          <TabsTrigger value="members">{m.tabs.members}</TabsTrigger>
          {isAdmin && <TabsTrigger value="requests">{m.tabs.requests}</TabsTrigger>}
          {isAdmin && <TabsTrigger value="audit">{m.tabs.audit}</TabsTrigger>}
          {isAdmin && <TabsTrigger value="settings">{m.tabs.settings}</TabsTrigger>}
        </TabsList>
        <TabsContent value="ops">
          <OpsTab eventId={id} isOperator={isOperator} />
        </TabsContent>
        <TabsContent value="flights">
          <FlightsTab eventId={id} />
        </TabsContent>
        <TabsContent value="zones">
          <ZonesTab eventId={id} canEdit={!!isAdmin} />
        </TabsContent>
        <TabsContent value="members">
          <MembersTab eventId={id} canEdit={!!isAdmin} />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="requests">
            <RequestsTab eventId={id} />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="audit">
            <AuditTab eventId={id} />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="settings">
            <SettingsTab event={event} onSaved={load} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
