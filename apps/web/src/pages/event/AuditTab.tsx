import { useEffect, useState } from "react";
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
import type { AuditLog } from "@/lib/types";

interface AuditRow extends AuditLog {
  actor?: { display_name: string } | null;
}

export default function AuditTab({ eventId }: { eventId: string }) {
  const { m, locale } = useI18n();
  const [logs, setLogs] = useState<AuditRow[]>([]);

  useEffect(() => {
    void supabase
      .from("audit_logs")
      .select("*, actor:profiles!audit_logs_actor_id_fkey(display_name)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(300)
      .then(({ data }) => setLogs((data as unknown as AuditRow[]) ?? []));
  }, [eventId]);

  if (logs.length === 0) return <p className="text-sm text-muted-foreground">{m.audit.empty}</p>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{m.audit.when}</TableHead>
          <TableHead>{m.audit.actor}</TableHead>
          <TableHead>{m.audit.action}</TableHead>
          <TableHead>{m.audit.entity}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((l) => (
          <TableRow key={l.id}>
            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
              {fmtDateTime(l.created_at, locale)}
            </TableCell>
            <TableCell>{l.actor?.display_name ?? l.actor_id?.slice(0, 8) ?? "—"}</TableCell>
            <TableCell className="font-mono text-xs">{l.action}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {l.entity}
              {l.entity_id ? `:${l.entity_id.slice(0, 8)}` : ""}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
