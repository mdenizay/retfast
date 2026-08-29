import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/i18n";
import { fmtDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { EventMember, EventRole } from "@/lib/types";
import { X } from "lucide-react";

export default function MembersTab({ eventId, canEdit }: { eventId: string; canEdit: boolean }) {
  const { m, locale } = useI18n();
  const [members, setMembers] = useState<EventMember[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("event_members")
      .select("*, profile:profiles!event_members_user_id_fkey(id, display_name, avatar_url, locale)")
      .eq("event_id", eventId)
      .order("created_at");
    setMembers((data as unknown as EventMember[]) ?? []);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(member: EventMember) {
    const { error } = await supabase.rpc("revoke_event_role", {
      p_event: eventId,
      p_user: member.user_id,
      p_role: member.role,
    });
    if (error) toast.error(error.message);
    else void load();
  }

  // Group per user for a compact roster.
  const byUser = new Map<string, EventMember[]>();
  for (const mem of members) {
    const list = byUser.get(mem.user_id) ?? [];
    list.push(mem);
    byUser.set(mem.user_id, list);
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{m.members.user}</TableHead>
          <TableHead>{m.members.role}</TableHead>
          <TableHead>{m.members.since}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...byUser.values()].map((rows) => (
          <TableRow key={rows[0].user_id}>
            <TableCell className="font-medium">
              {rows[0].profile?.display_name ?? rows[0].user_id.slice(0, 8)}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {rows.map((r) => (
                  <Badge key={r.id} variant="secondary" className="gap-1">
                    {m.roles[r.role as EventRole]}
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-4 p-0"
                        title={m.members.remove}
                        onClick={() => revoke(r)}
                      >
                        <X className="size-3" />
                      </Button>
                    )}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {fmtDateTime(rows[0].created_at, locale)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
