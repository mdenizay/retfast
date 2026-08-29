import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabase";
import type { EventRow, EventVisibility } from "@/lib/types";
import { RefreshCw } from "lucide-react";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SettingsTab({ event, onSaved }: { event: EventRow; onSaved: () => void }) {
  const { m } = useI18n();
  const [name, setName] = useState(event.name);
  const [description, setDescription] = useState(event.description);
  const [startsAt, setStartsAt] = useState(toLocalInput(event.starts_at));
  const [endsAt, setEndsAt] = useState(toLocalInput(event.ends_at));
  const [visibility, setVisibility] = useState<EventVisibility>(event.visibility);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase
      .from("events")
      .update({
        name,
        description,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        visibility,
      })
      .eq("id", event.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else onSaved();
  }

  async function fetchCode(rotate: boolean) {
    const { data, error } = await supabase.rpc("event_invite_code", {
      p_event: event.id,
      p_rotate: rotate,
    });
    if (error) toast.error(error.message);
    else setInviteCode(data as string);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.tabs.settings}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
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
                />
              </div>
              <div className="space-y-2">
                <Label>{m.events.endsAt}</Label>
                <Input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
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
            <Button type="submit" disabled={busy}>
              {m.common.save}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.events.inviteCode}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {inviteCode ? (
            <p className="font-mono text-2xl tracking-widest">{inviteCode}</p>
          ) : (
            <Button variant="outline" onClick={() => fetchCode(false)}>
              {m.events.showCode}
            </Button>
          )}
          <div>
            <Button variant="ghost" size="sm" onClick={() => fetchCode(true)}>
              <RefreshCw className="size-4" />
              {m.events.rotateCode}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
