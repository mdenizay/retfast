"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Announcement, Application, EventDetail, EventReport, Member, PointKind, Role } from "@retfast/core";
import { MapView, POINT_COLORS, setEventFeatures } from "@/components/map";
import { Badge, Button, Card, Empty, ErrorText, Field, Input, Pills, Select, Spinner, Textarea } from "@/components/ui";
import { api, errorCode } from "@/lib/api";
import { formatDate, useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { Map as MlMap } from "maplibre-gl";
import { isDarkBase, type BasemapId } from "@/lib/basemaps";
import { EventForm } from "@/components/events/event-form";

type Tab = "applications" | "members" | "map" | "vehicles" | "announcements" | "report" | "settings";
const ROLES: Role[] = ["pilot", "retriever", "observer"];
const KINDS: PointKind[] = ["takeoff", "landing", "alt_landing", "emergency_landing", "meeting", "hazard"];

export default function ManagePage() {
  const { id } = useParams<{ id: string }>();
  const { t, err } = useI18n();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [tab, setTab] = useState<Tab>("applications");
  const [error, setError] = useState<string>();
  const reload = useCallback(() => api.events.get(id).then(setEv).catch((x) => setError(err(errorCode(x)))), [id, err]);
  useEffect(() => void reload(), [reload]);

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!ev) return <div className="flex justify-center py-24"><Spinner /></div>;

  return (
    <div>
      <Link href={`/events/${ev.id}`} className="text-sm text-label-2 hover:text-label">← {ev.name}</Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{t("manage.title")}</h1>
        <Badge tone={ev.status === "active" ? "amber" : "default"}>{t(`status.${ev.status}`)}</Badge>
        <Link href={`/app/events/${ev.id}/live`} className="ml-auto"><Button variant="primary">{t("events.open_console")}</Button></Link>
      </div>
      <Pills className="mt-6 max-w-full overflow-x-auto" value={tab} onChange={setTab}
        options={(["applications", "members", "map", "vehicles", "announcements", "report", "settings"] as Tab[]).map((k) => ({ value: k, label: t(`manage.tab.${k}`) }))} />
      <div className="mt-6">
        {tab === "applications" && <Applications eventId={ev.id} />}
        {tab === "members" && <Members ev={ev} />}
        {tab === "map" && <Points ev={ev} onChange={reload} />}
        {tab === "vehicles" && <Vehicles ev={ev} onChange={reload} />}
        {tab === "announcements" && <Announcements eventId={ev.id} />}
        {tab === "report" && <Report eventId={ev.id} />}
        {tab === "settings" && <Settings ev={ev} onChange={setEv} />}
      </div>
    </div>
  );
}

function useAction() {
  const { err } = useI18n();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      return true;
    } catch (x) {
      setError(err(errorCode(x)));
      return false;
    } finally {
      setBusy(false);
    }
  }, [err]);
  return { error, busy, run };
}

function Applications({ eventId }: { eventId: string }) {
  const { t, locale } = useI18n();
  const [list, setList] = useState<Application[] | null>(null);
  const [filter, setFilter] = useState<"pending" | "">("pending");
  const { error, busy, run } = useAction();
  const load = useCallback(() => api.events.applications(eventId, filter || undefined).then((r) => setList(r.data)), [eventId, filter]);
  useEffect(() => void load(), [load]);

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <Button size="sm" variant={filter === "pending" ? "primary" : "secondary"} onClick={() => setFilter("pending")}>{t("manage.pending")}</Button>
        <Button size="sm" variant={filter === "" ? "primary" : "secondary"} onClick={() => setFilter("")}>{t("live.all")}</Button>
      </div>
      <ErrorText>{error}</ErrorText>
      {list === null ? <Spinner /> : list.length === 0 ? <Empty>{t("manage.no_applications")}</Empty> : (
        <div className="grid gap-3">
          {list.map((a) => (
            <Card key={a.id} className="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{a.user.first_name} {a.user.last_name}</p>
                  <p className="text-sm text-label-2">{a.user.email}{a.user.phone ? ` · ${a.user.phone}` : ""}{a.user.country ? ` · ${a.user.country}` : ""}</p>
                  <p className="num text-xs text-label-2">{formatDate(locale, a.created_at)}{a.requested_role ? ` · ${t("manage.requested", { role: t(`role.${a.requested_role}`) })}` : ""}</p>
                  {a.message && <p className="mt-2 text-sm">“{a.message}”</p>}
                </div>
                {a.status === "pending" ? (
                  <div className="flex flex-wrap gap-2">
                    {ROLES.map((r) => (
                      <Button key={r} size="sm" variant={r === a.requested_role ? "primary" : "secondary"} disabled={busy}
                        onClick={() => run(() => api.applications.decide(a.id, { decision: "accept", role: r })).then((ok) => { if (ok) void load(); })}>
                        {t("manage.accept_as", { role: t(`role.${r}`) })}
                      </Button>
                    ))}
                    <Button size="sm" variant="ghost" disabled={busy}
                      onClick={() => run(() => api.applications.decide(a.id, { decision: "reject" })).then((ok) => { if (ok) void load(); })}>{t("manage.reject")}</Button>
                  </div>
                ) : (
                  <Badge tone={a.status === "accepted" ? "ok" : "default"}>{a.status === "accepted" && a.decided_role ? t(`role.${a.decided_role}`) : a.status}</Badge>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Members({ ev }: { ev: EventDetail }) {
  const { t } = useI18n();
  const { user } = useSession();
  const [list, setList] = useState<Member[] | null>(null);
  const { error, busy, run } = useAction();
  const load = useCallback(() => api.events.members(ev.id).then((r) => setList(r.data)), [ev.id]);
  useEffect(() => void load(), [load]);
  const roles: Role[] = user?.is_system_admin ? ["event_admin", ...ROLES] : ROLES;

  return (
    <div className="space-y-6">
      <InviteBox eventId={ev.id} />
      <ErrorText>{error}</ErrorText>
      {list === null ? <Spinner /> : list.length === 0 ? <Empty>{t("dash.none")}</Empty> : (
        <div className="overflow-x-auto rounded-[28px] border border-hair">
          <table className="w-full text-sm">
            <tbody>
              {list.map((m) => (
                <tr key={m.user_id} className="border-b border-hair/60 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{m.first_name} {m.last_name}</p>
                    <p className="text-xs text-label-2">{m.email}{m.phone ? ` · ${m.phone}` : ""}</p>
                  </td>
                  <td className="px-2 py-3">
                    <Input className="h-8 w-20" defaultValue={m.bib ?? ""} placeholder="#" disabled={busy}
                      onBlur={(e) => e.target.value !== (m.bib ?? "") && run(() => api.events.setMember(ev.id, m.user_id, { role: m.role, bib: e.target.value || null, vehicle_id: m.vehicle_id }))} />
                  </td>
                  <td className="px-2 py-3">
                    <Select className="h-8" value={m.role} disabled={busy || (m.role === "event_admin" && !user?.is_system_admin)}
                      onChange={(e) => run(() => api.events.setMember(ev.id, m.user_id, { role: e.target.value as Role, vehicle_id: m.vehicle_id })).then(load)}>
                      {(m.role === "event_admin" && !user?.is_system_admin ? ["event_admin" as Role] : roles).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                    </Select>
                  </td>
                  <td className="px-2 py-3">
                    {m.role === "retriever" && (
                      <Select className="h-8" value={m.vehicle_id ?? ""} disabled={busy}
                        onChange={(e) => run(() => api.events.setMember(ev.id, m.user_id, { role: m.role, vehicle_id: e.target.value || null })).then(load)}>
                        <option value="">—</option>
                        {ev.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </Select>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" disabled={busy}
                      onClick={() => confirm(t("manage.confirm_remove")) && run(() => api.events.removeMember(ev.id, m.user_id)).then(load)}>{t("manage.remove")}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Points({ ev, onChange }: { ev: EventDetail; onChange: () => void }) {
  const { t } = useI18n();
  const [map, setMap] = useState<MlMap | null>(null);
  const [base, setBase] = useState<BasemapId>("dark");
  const [rev, setRev] = useState(0);
  const [draft, setDraft] = useState<{ lat: number; lon: number } | null>(null);
  const { error, busy, run } = useAction();
  useEffect(() => {
    if (map) setEventFeatures(map, [...ev.points, ...(draft ? [{ id: "draft", kind: "meeting", name: "•", ...draft }] : [])], ev.zones, isDarkBase(base));
  }, [map, ev, draft, base, rev]);
  const center: [number, number] = [ev.center_lon ?? ev.points[0]?.lon ?? 29.3, ev.center_lat ?? ev.points[0]?.lat ?? 37.1];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ok = await run(() => api.events.addPoint(ev.id, {
      kind: f.get("kind") as PointKind, name: String(f.get("name")), lat: Number(f.get("lat")), lon: Number(f.get("lon")),
      altitude_m: f.get("alt") ? Number(f.get("alt")) : null, description: String(f.get("description") ?? ""), instructions: String(f.get("instructions") ?? ""),
    }));
    if (ok) {
      setDraft(null);
      e.currentTarget?.reset();
      onChange();
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div>
        <Card className="h-[480px] overflow-hidden">
          <MapView center={center} zoom={ev.center_lat ? 11 : 8} onReady={(m, b) => { setMap(m); setBase(b); setRev((r) => r + 1); }} onClick={(p) => setDraft({ lat: +p.lat.toFixed(6), lon: +p.lng.toFixed(6) })} />
        </Card>
        <div className="mt-4 grid gap-2">
          {ev.points.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-[20px] border border-hair bg-surface px-4 py-3 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: POINT_COLORS[p.kind] }} />
              <span className="flex-1">{p.name} <span className="text-label-2">· {t(`point.${p.kind}`)} · {p.lat.toFixed(4)}, {p.lon.toFixed(4)}</span></span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api.events.deletePoint(ev.id, p.id)).then(onChange)}>{t("common.delete")}</Button>
            </div>
          ))}
        </div>
      </div>
      <Card className="h-fit p-4">
        <p className="font-bold">{t("manage.add_point")}</p>
        <p className="mt-1 text-xs text-label-2">{t("manage.add_point_hint")}</p>
        <form onSubmit={submit} className="mt-4 space-y-3" key={draft ? `${draft.lat},${draft.lon}` : "empty"}>
          <Field label={t("form.kind")}><Select name="kind">{KINDS.map((k) => <option key={k} value={k}>{t(`point.${k}`)}</option>)}</Select></Field>
          <Field label={t("form.name")}><Input name="name" required /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("form.latitude")}><Input name="lat" type="number" step="any" required defaultValue={draft?.lat} /></Field>
            <Field label={t("form.longitude")}><Input name="lon" type="number" step="any" required defaultValue={draft?.lon} /></Field>
          </div>
          <Field label={t("form.altitude")}><Input name="alt" type="number" /></Field>
          <Field label={t("form.description")}><Input name="description" /></Field>
          <Field label={t("form.instructions")}><Textarea name="instructions" /></Field>
          <ErrorText>{error}</ErrorText>
          <Button variant="primary" className="w-full" disabled={busy}>{t("common.create")}</Button>
        </form>
      </Card>
    </div>
  );
}

function Vehicles({ ev, onChange }: { ev: EventDetail; onChange: () => void }) {
  const { t } = useI18n();
  const { error, busy, run } = useAction();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const ok = await run(() => api.events.addVehicle(ev.id, { name: String(f.get("name")), plate: String(f.get("plate") ?? "") || null, capacity: Number(f.get("capacity") || 4) }));
    if (ok) {
      form.reset();
      onChange();
    }
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="grid gap-2">
        {ev.vehicles.length === 0 && <Empty>—</Empty>}
        {ev.vehicles.map((v) => (
          <div key={v.id} className="flex items-center gap-3 rounded-[20px] border border-hair bg-surface px-5 py-3.5">
            <span className="flex-1 font-medium">{v.name} <span className="text-sm text-label-2">{v.plate} · {v.capacity} {t("manage.capacity").toLowerCase()}</span></span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api.events.deleteVehicle(ev.id, v.id)).then(onChange)}>{t("common.delete")}</Button>
          </div>
        ))}
      </div>
      <Card className="h-fit p-4">
        <form onSubmit={submit} className="space-y-3">
          <p className="font-bold">{t("manage.add_vehicle")}</p>
          <Field label={t("form.name")}><Input name="name" required /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("manage.plate")}><Input name="plate" /></Field>
            <Field label={t("manage.capacity")}><Input name="capacity" type="number" min={1} max={60} defaultValue={4} /></Field>
          </div>
          <ErrorText>{error}</ErrorText>
          <Button variant="primary" className="w-full" disabled={busy}>{t("common.create")}</Button>
        </form>
      </Card>
    </div>
  );
}

function Settings({ ev, onChange }: { ev: EventDetail; onChange: (e: EventDetail) => void }) {
  const { t } = useI18n();
  const { error, busy, run } = useAction();
  const [saved, setSaved] = useState(false);
  return (
    <Card className="p-5">
      {ev.invite_code && <p className="mb-5 text-sm">{t("manage.invite_code")}: <code className="rounded bg-fill-2 px-2 py-1 font-bold text-tint">{ev.invite_code}</code></p>}
      <EventForm ev={ev} busy={busy} onSubmit={(body) => run(async () => {
        onChange(await api.events.update(ev.id, body));
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })}>
        <ErrorText>{error}</ErrorText>
        {saved && <p className="mb-2 text-sm text-ok">{t("manage.saved")}</p>}
      </EventForm>
    </Card>
  );
}

function InviteBox({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  const { error, busy, run } = useAction();
  const [msg, setMsg] = useState<string>();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const emails = String(f.get("emails") ?? "").split(/[\s,;]+/).filter(Boolean);
    const ok = await run(async () => {
      const r = await api.events.invite(eventId, { emails, message: String(f.get("message") ?? "") });
      setMsg([t("invite.sent", { n: r.sent }), r.skipped.length ? t("invite.skipped", { list: r.skipped.join(", ") }) : ""].filter(Boolean).join(" "));
    });
    if (ok) form.reset();
  }
  return (
    <Card className="p-5">
      <form onSubmit={submit} className="space-y-3">
        <p className="t-headline">{t("invite.title")}</p>
        <Field label={t("invite.emails")}><Textarea name="emails" required rows={3} /></Field>
        <Field label={t("invite.message")}><Input name="message" maxLength={1000} /></Field>
        <ErrorText>{error}</ErrorText>
        {msg && <p className="text-sm text-ok">{msg}</p>}
        <Button variant="primary" disabled={busy}>{t("invite.send")}</Button>
      </form>
    </Card>
  );
}

function Announcements({ eventId }: { eventId: string }) {
  const { t, locale } = useI18n();
  const [list, setList] = useState<Announcement[] | null>(null);
  const { error, busy, run } = useAction();
  const load = useCallback(() => api.events.announcements(eventId).then((r) => setList(r.data)), [eventId]);
  useEffect(() => void load(), [load]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const ok = await run(() => api.events.postAnnouncement(eventId, { title: String(f.get("title")), body: String(f.get("body") ?? "") }));
    if (ok) {
      form.reset();
      void load();
    }
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-3">
        {list === null ? <Spinner /> : list.length === 0 ? <Empty>{t("ann.none")}</Empty> : list.map((a) => (
          <Card key={a.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="t-headline">{a.title}</p>
                <p className="t-foot">{a.author} · {formatDate(locale, a.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => run(() => api.events.deleteAnnouncement(a.id)).then(load)}>{t("common.delete")}</Button>
            </div>
            {a.body && <p className="mt-3 whitespace-pre-line text-[15px]">{a.body}</p>}
          </Card>
        ))}
      </div>
      <Card className="h-fit p-5">
        <form onSubmit={submit} className="space-y-3">
          <Field label={t("ann.title")}><Input name="title" required maxLength={120} /></Field>
          <Field label={t("ann.body")}><Textarea name="body" rows={5} maxLength={4000} /></Field>
          <ErrorText>{error}</ErrorText>
          <Button variant="primary" className="w-full" disabled={busy}>{t("ann.post")}</Button>
        </form>
      </Card>
    </div>
  );
}

function Report({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  const [r, setR] = useState<EventReport | null>(null);
  useEffect(() => void api.events.report(eventId).then(setR), [eventId]);
  if (!r) return <Spinner />;
  const n = (v: number | null | undefined) => (v == null ? "—" : String(v));
  const tiles: [string, string][] = [
    [t("report.members"), String(Object.values(r.members).reduce((a, b) => a + (b ?? 0), 0))],
    [t("report.flights"), n(r.flights.total)],
    [t("report.flights_done"), n(r.flights.completed)],
    [t("report.pilots_flown"), n(r.flights.pilots)],
    [t("report.airtime"), n(r.flights.avg_airtime_min)],
    [t("report.retrieves"), n(r.retrieves.total)],
    [t("report.retrieves_done"), n(r.retrieves.completed)],
    [t("report.retrieves_cancelled"), n(r.retrieves.cancelled)],
    [t("report.assign"), n(r.retrieves.avg_assign_min)],
    [t("report.pickup"), n(r.retrieves.avg_pickup_min)],
    [t("report.total"), n(r.retrieves.avg_total_min)],
    [t("report.sos"), `${r.sos.resolved}/${r.sos.total}`],
    [t("report.tracking"), n(r.tracking.points)],
  ];
  const max = Math.max(1, ...r.by_day.map((d) => d.flights));
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(([label, value], i) => (
          <Card key={`${i}-${label}`} className="p-4">
            <p className="t-foot">{label}</p>
            <p className="t-metric mt-2">{value}</p>
          </Card>
        ))}
      </div>
      {r.by_day.length > 0 && (
        <Card className="p-5">
          <p className="t-headline">{t("report.by_day")}</p>
          <div className="mt-4 flex h-32 items-end gap-2">
            {r.by_day.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                <span className="num t-foot">{d.flights}</span>
                <div className="w-full rounded-t-[8px] bg-tint-fill" style={{ height: `${(d.flights / max) * 100}%`, minHeight: 4 }} />
                <span className="t-foot">{d.day.slice(5)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
