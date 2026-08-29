import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

export default function UsersPage() {
  const { m } = useI18n();
  const [users, setUsers] = useState<Profile[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    void supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => setUsers((data as Profile[]) ?? []));
  }, []);

  const filtered = users.filter((u) =>
    u.display_name.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{m.users.title}</h1>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={m.users.search}
          className="ml-auto w-64"
        />
      </div>
      <p className="text-xs text-muted-foreground">{m.users.hint}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{m.members.user}</TableHead>
            <TableHead>ID</TableHead>
            <TableHead>{m.common.language}</TableHead>
            <TableHead>{m.users.systemAdmin}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">{u.display_name}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{u.id}</TableCell>
              <TableCell>{u.locale}</TableCell>
              <TableCell>
                {u.is_system_admin && <Badge>{m.users.systemAdmin}</Badge>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
