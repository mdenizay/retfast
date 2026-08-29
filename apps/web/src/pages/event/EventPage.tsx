import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
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
import { ArrowLeft, CalendarRange, Radio, ShieldCheck } from "lucide-react";

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
    <div className="space-y-6">
      <Link to="/events" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> {m.events.title}
      </Link>
      <section className="relative overflow-hidden rounded-[28px] border border-white/8 bg-[#171816] p-6 sm:p-8">
        <div className="absolute -right-16 -top-24 size-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <div className="brand-kicker">MISSION WORKSPACE</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h1 className="page-heading">{event.name}</h1>
          {roles.map((r) => (
            <Badge key={r} variant="secondary" className="rounded-full">
              {m.roles[r]}
            </Badge>
          ))}
          {event.is_archived && <Badge variant="destructive">{m.events.archived}</Badge>}
            </div>
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarRange className="size-4 text-primary" />
          {fmtDateTime(event.starts_at, locale)} → {fmtDateTime(event.ends_at, locale)}
            </p>
            {event.description && <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">{event.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && <div className="flex h-11 items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-4 text-xs font-semibold text-muted-foreground"><ShieldCheck className="size-4 text-primary" />{m.roles.event_admin}</div>}
            <Link to={`/events/${id}/ops`} className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/15">
              <Radio className="size-4" /> {m.ops.openConsole}
            </Link>
          </div>
        </div>
      </section>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl border border-white/8 bg-white/[0.035] p-1.5">
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
