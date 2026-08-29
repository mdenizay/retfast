import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/auth/AuthProvider";
import { useI18n } from "@/i18n";
import { fmtDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { EventRole, EventRow, EventVisibility } from "@/lib/types";

interface EventWithRoles extends EventRow {
  roles: EventRole[];
}

export default function EventsPage() {
  const { m } = useI18n();
  const { session, profile } = useAuth();
  const [events, setEvents] = useState<EventWithRoles[]>([]);
  const [code, setCode] = useState("");
  const [joinTarget, setJoinTarget] = useState<EventRow | null>(null);

  async function load() {
    const [{ data: evs }, { data: memberships }] = await Promise.all([
      supabase.from("events").select("*").order("starts_at", { ascending: false }),
      supabase.from("event_members").select("event_id, role").eq("user_id", session!.user.id),
    ]);
    const roleMap = new Map<string, EventRole[]>();
    for (const mrow of memberships ?? []) {
      const list = roleMap.get(mrow.event_id) ?? [];
      list.push(mrow.role as EventRole);
      roleMap.set(mrow.event_id, list);
    }
    setEvents(((evs as EventRow[]) ?? []).map((e) => ({ ...e, roles: roleMap.get(e.id) ?? [] })));
  }

  useEffect(() => {
    if (session) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function lookupCode(e: FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.rpc("join_event_by_code", { p_code: code });
    if (error || !data?.length) {
      toast.error(error?.message ?? m.common.error);
      return;
    }
    setJoinTarget(data[0] as EventRow);
  }

  const mine = events.filter((e) => e.roles.length > 0);
  const discover = events.filter((e) => e.roles.length === 0 && !e.is_archived);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{m.events.title}</h1>
        <form onSubmit={lookupCode} className="ml-auto flex items-center gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={m.events.codePlaceholder}
            className="w-40"
          />
          <Button type="submit" variant="secondary">
            {m.events.lookup}
          </Button>
        </form>
        {profile?.is_system_admin && <CreateEventDialog onCreated={load} />}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {m.events.myEvents}
        </h2>
        {mine.length === 0 && <p className="text-sm text-muted-foreground">{m.events.noEvents}</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mine.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {m.events.discover}
        </h2>
        {discover.length === 0 && (
          <p className="text-sm text-muted-foreground">{m.events.noEvents}</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {discover.map((e) => (
            <EventCard key={e.id} event={e} onRequest={() => setJoinTarget(e)} />
          ))}
        </div>
      </section>

      {joinTarget && (
        <RequestParticipationDialog
          event={joinTarget}
          inviteCode={code}
          onClose={() => setJoinTarget(null)}
        />
      )}
    </div>
  );
}

function EventCard({ event, onRequest }: { event: EventWithRoles | EventRow; onRequest?: () => void }) {
  const { m, locale } = useI18n();
  const roles = "roles" in event ? (event as EventWithRoles).roles : [];
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-start justify-between gap-2 text-base">
          {roles.length > 0 ? (
            <Link to={`/events/${event.id}`} className="hover:underline">
              {event.name}
            </Link>
          ) : (
            <span>{event.name}</span>
          )}
          <Badge variant="outline">{m.events[event.visibility as EventVisibility]}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="line-clamp-2 text-sm text-muted-foreground">{event.description}</p>
        <p className="text-xs text-muted-foreground">
          {fmtDateTime(event.starts_at, locale)} → {fmtDateTime(event.ends_at, locale)}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-1">
          {roles.map((r) => (
            <Badge key={r} variant="secondary">
              {m.roles[r]}
            </Badge>
          ))}
          {roles.length === 0 && onRequest && (
            <Button size="sm" variant="outline" onClick={onRequest}>
              {m.events.requestRole}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RequestParticipationDialog({
  event,
  inviteCode,
  onClose,
}: {
  event: EventRow;
  inviteCode: string;
  onClose: () => void;
}) {
  const { m } = useI18n();
  const [role, setRole] = useState<EventRole>("pilot");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    const { error } = await supabase.rpc("request_participation", {
      p_event: event.id,
      p_role: role,
      p_message: message,
      p_invite_code: inviteCode || null,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(m.events.requestSent);
      onClose();
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {m.events.requestRole} — {event.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{m.events.requestedRole}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as EventRole)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["pilot", "retriever", "observer"] as EventRole[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {m.roles[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{m.events.message}</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
          </div>
          <Button onClick={send} disabled={busy} className="w-full">
            {m.events.sendRequest}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateEventDialog({ onCreated }: { onCreated: () => void }) {
  const { m } = useI18n();
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [visibility, setVisibility] = useState<EventVisibility>("public");
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("events").insert({
      name,
      description,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
      visibility,
      created_by: session!.user.id,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      setOpen(false);
      onCreated();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{m.events.newEvent}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.events.newEvent}</DialogTitle>
        </DialogHeader>
        <form onSubmit={create} className="space-y-4">
          <div className="space-y-2">
            <Label>{m.events.name}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>{m.events.description}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{m.events.startsAt}</Label>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{m.events.endsAt}</Label>
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{m.events.visibility}</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as EventVisibility)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["public", "unlisted", "private"] as EventVisibility[]).map((v) => (
                  <SelectItem key={v} value={v}>
                    {m.events[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {m.common.create}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
