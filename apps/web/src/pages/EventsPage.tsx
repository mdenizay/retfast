import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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
import { Activity, ArrowUpRight, CalendarRange, Compass, Plus, Ticket } from "lucide-react";

interface EventWithRoles extends EventRow {
  roles: EventRole[];
}

export default function EventsPage() {
  const { m, locale } = useI18n();
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
    <div className="space-y-10">
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="relative overflow-hidden rounded-[28px] border border-white/8 bg-[#171816] p-6 sm:p-8">
          <div className="absolute -right-16 -top-24 size-72 rounded-full bg-primary/10 blur-3xl" />
          <div className="brand-kicker">OPERATIONS HOME</div>
          <h1 className="page-heading mt-2">{m.events.title}</h1>
          <p className="page-lead">
            {locale === "tr"
              ? "Uçuş operasyonlarını, ekipleri ve canlı görevleri tek bir çalışma alanından yönetin."
              : "Manage live flight operations, teams and missions from one focused workspace."}
          </p>
          <div className="mt-7 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="metric-card">
              <Activity className="mb-4 size-5 text-primary" />
              <div className="text-2xl font-bold tabular-nums">{mine.length}</div>
              <div className="text-xs text-muted-foreground">{m.events.myEvents}</div>
            </div>
            <div className="metric-card">
              <Compass className="mb-4 size-5 text-primary" />
              <div className="text-2xl font-bold tabular-nums">{discover.length}</div>
              <div className="text-xs text-muted-foreground">{m.events.discover}</div>
            </div>
            <div className="metric-card col-span-2 sm:col-span-1">
              <CalendarRange className="mb-4 size-5 text-primary" />
              <div className="text-2xl font-bold tabular-nums">{events.length}</div>
              <div className="text-xs text-muted-foreground">{locale === "tr" ? "Toplam" : "Total"}</div>
            </div>
          </div>
        </div>

        <Card className="operational-card justify-between p-2">
          <CardHeader>
            <div className="mb-3 grid size-11 place-items-center rounded-2xl bg-primary/12 text-primary">
              <Ticket className="size-5" />
            </div>
            <CardTitle className="text-xl">{m.events.joinByCode}</CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              {locale === "tr" ? "Organizatörün paylaştığı kodla özel bir etkinliğe erişin." : "Access a private event with the code shared by its organiser."}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={lookupCode} className="flex gap-2">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={m.events.codePlaceholder} className="h-12" />
              <Button type="submit" size="lg" aria-label={m.events.lookup}><ArrowUpRight /></Button>
            </form>
            {profile?.is_system_admin && (
              <div className="mt-3"><CreateEventDialog onCreated={load} /></div>
            )}
          </CardContent>
        </Card>
      </section>

      <EventSection title={m.events.myEvents} count={mine.length} empty={m.events.noEvents}>
        {mine.map((e) => <EventCard key={e.id} event={e} />)}
      </EventSection>

      <EventSection title={m.events.discover} count={discover.length} empty={m.events.noEvents}>
        {discover.map((e) => <EventCard key={e.id} event={e} onRequest={() => setJoinTarget(e)} />)}
      </EventSection>

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

function EventSection({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <Badge variant="secondary" className="rounded-full">{count}</Badge>
        <div className="h-px flex-1 bg-white/8" />
      </div>
      {count === 0 && <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-muted-foreground">{empty}</div>}
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{children}</div>
    </section>
  );
}

function EventCard({ event, onRequest }: { event: EventWithRoles | EventRow; onRequest?: () => void }) {
  const { m, locale } = useI18n();
  const roles = "roles" in event ? (event as EventWithRoles).roles : [];
  return (
    <Card className="operational-card group flex min-h-64 flex-col">
      <CardHeader className="pb-3">
        <div className="mb-5 flex items-center justify-between">
          <div className="grid size-11 place-items-center rounded-2xl border border-primary/15 bg-primary/8 text-primary">
            <NavigationMark />
          </div>
          <ArrowUpRight className="size-5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
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
      <CardContent className="flex flex-1 flex-col gap-4">
        <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{event.description}</p>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarRange className="size-4 text-primary" />
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

function NavigationMark() {
  return <Compass className="size-5" />;
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
        <Button variant="outline" className="w-full"><Plus />{m.events.newEvent}</Button>
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
