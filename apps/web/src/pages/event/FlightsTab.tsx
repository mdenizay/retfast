import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
import type { Task, TaskStatus } from "@/lib/types";
import { PlayCircle } from "lucide-react";

const STATUS_VARIANT: Record<TaskStatus, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  landed: "secondary",
  completed: "outline",
  cancelled: "destructive",
};

export default function FlightsTab({ eventId }: { eventId: string }) {
  const { m, locale } = useI18n();
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    void supabase
      .from("tasks")
      .select("*, profile:profiles(id, display_name)")
      .eq("event_id", eventId)
      .order("started_at", { ascending: false })
      .then(({ data }) => setTasks((data as unknown as Task[]) ?? []));
  }, [eventId]);

  if (tasks.length === 0)
    return <p className="text-sm text-muted-foreground">{m.flights.empty}</p>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{m.flights.pilot}</TableHead>
          <TableHead>{m.ops.task}</TableHead>
          <TableHead>{m.flights.status}</TableHead>
          <TableHead>{m.flights.started}</TableHead>
          <TableHead>{m.flights.landed}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="font-medium">
              {t.profile?.display_name ?? t.pilot_id.slice(0, 8)}
            </TableCell>
            <TableCell>{t.title}</TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[t.status]}>{m.flights.statuses[t.status]}</Badge>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {fmtDateTime(t.started_at, locale)}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {fmtDateTime(t.landed_at, locale)}
            </TableCell>
            <TableCell>
              <Button asChild size="sm" variant="ghost">
                <Link to={`/replay/${t.id}`}>
                  <PlayCircle className="size-4" />
                  {m.flights.replay}
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
