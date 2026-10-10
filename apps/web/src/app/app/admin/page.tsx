"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { EventSummary } from "@retfast/core";
import { Badge, Button, Card, ErrorText, Input, Pills, Select, Spinner } from "@/components/ui";
import { EventForm } from "@/components/events/event-form";
import { api, errorCode } from "@/lib/api";
import { formatRange, useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";

type AdminEvent = EventSummary & { visibility: string; members: number; pending_applications: number };
type AdminUser = Awaited<ReturnType<typeof api.admin.users>>["data"][number];

export default function AdminPage() {
  const { t } = useI18n();
  const { user } = useSession();
  const [tab, setTab] = useState<"events" | "users" | "stats">("events");
  if (!user?.is_system_admin) return <ErrorText>{t("error.FORBIDDEN")}</ErrorText>;
  return (
    <div>
      <h1 className="text-3xl font-light tracking-tight">{t("admin.title")}</h1>
      <Pills className="mt-6" value={tab} onChange={setTab}
        options={(["events", "users", "stats"] as const).map((k) => ({ value: k, label: t(`admin.${k}`) }))} />
      <div className="mt-6">
        {tab === "events" && <Events />}
        {tab === "users" && <Users />}
        {tab === "stats" && <Stats />}
      </div>
    </div>
  );
}

function Events() {
  const { t, err, locale } = useI18n();
  const router = useRouter();
  const [list, setList] = useState<AdminEvent[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => void api.admin.events().then((r) => setList(r.data)), []);

  return (
    <div>
      <Button variant="primary" onClick={() => setCreating((c) => !c)}>{t("admin.new_event")}</Button>
      {creating && (
        <Card className="mt-4 p-5">
          <EventForm busy={busy} onSubmit={async (body) => {
            setBusy(true);
            setError(undefined);
            try {
              const ev = await api.events.create(body);
              router.push(`/app/events/${ev.id}/manage`);
            } catch (x) {
              setError(err(errorCode(x)));
            } finally {
              setBusy(false);
            }
          }}><ErrorText>{error}</ErrorText></EventForm>
        </Card>
      )}
      <div className="mt-6 grid gap-2">
        {list === null && <Spinner />}
        {list?.map((e) => (
          <Link key={e.id} href={`/app/events/${e.id}/manage`} className="flex flex-wrap items-center gap-3 rounded-[22px] border border-white/[0.06] bg-surface/90 px-5 py-3.5 hover:border-amber/60">
            <span className="flex-1 font-medium">{e.name}</span>
            <span className="num text-sm text-muted">{formatRange(locale, e.starts_at, e.ends_at)}</span>
            <Badge>{e.members}</Badge>
            {e.pending_applications > 0 && <Badge tone="amber">{e.pending_applications} {t("manage.pending").toLowerCase()}</Badge>}
            <Badge tone={e.status === "active" ? "amber" : "default"}>{t(`status.${e.status}`)}</Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Users() {
  const { t, err } = useI18n();
  const [q, setQ] = useState("");
  const [list, setList] = useState<AdminUser[] | null>(null);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [target, setTarget] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string>();
  const search = useCallback(() => api.admin.users(q).then((r) => setList(r.data)), [q]);
  useEffect(() => {
    void search();
    void api.admin.events().then((r) => setEvents(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); void search(); }} className="flex max-w-md gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("admin.search_users")} />
        <Button>{t("live.search").split(" ")[0]}</Button>
      </form>
      {msg && <p className="mt-3 text-sm text-ok">{msg}</p>}
      <div className="mt-4 grid gap-2">
        {list?.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-[22px] border border-white/[0.06] bg-surface/90 px-5 py-3.5 text-sm">
            <span className="min-w-48 flex-1">
              <span className="font-medium">{u.first_name} {u.last_name}</span> {u.is_system_admin && <Badge tone="amber">admin</Badge>}
              <span className="block text-xs text-muted">{u.email}</span>
            </span>
            <Select className="h-8 w-56" value={target[u.id] ?? ""} onChange={(e) => setTarget((s) => ({ ...s, [u.id]: e.target.value }))}>
              <option value="">{t("admin.events")}…</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
            <Button size="sm" disabled={!target[u.id]} onClick={async () => {
              try {
                await api.events.setMember(target[u.id]!, u.id, { role: "event_admin" });
                setMsg(`${u.first_name} → ${t("role.event_admin")}`);
              } catch (x) {
                setMsg(err(errorCode(x)));
              }
            }}>{t("admin.make_event_admin")}</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stats() {
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    const load = () => api.admin.stats().then(setS);
    void load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);
  if (!s) return <Spinner />;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {Object.entries(s).map(([k, v]) => (
        <Card key={k} className="p-4">
          <p className="kicker">{k.replaceAll("_", " ")}</p>
          <p className="num mt-1 text-3xl font-light tracking-tight">{typeof v === "object" ? JSON.stringify(v) : String(v)}</p>
        </Card>
      ))}
    </div>
  );
}
