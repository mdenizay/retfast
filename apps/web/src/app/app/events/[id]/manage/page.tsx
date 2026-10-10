"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Application, EventDetail, Member, PointKind, Role } from "@retfast/core";
import { MapView, POINT_COLORS, setEventFeatures } from "@/components/map";
import { Badge, Button, Card, Empty, ErrorText, Field, Input, Pills, Select, Spinner, Textarea } from "@/components/ui";
import { api, errorCode } from "@/lib/api";
import { formatDate, useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { Map as MlMap } from "maplibre-gl";
import { EventForm } from "@/components/events/event-form";

type Tab = "applications" | "members" | "map" | "vehicles" | "settings";
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
      <Link href={`/events/${ev.id}`} className="text-sm text-muted hover:text-ivory">← {ev.name}</Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-light tracking-tight">{t("manage.title")}</h1>
        <Badge tone={ev.status === "active" ? "amber" : "default"}>{t(`status.${ev.status}`)}</Badge>
        <Link href={`/app/events/${ev.id}/live`} className="ml-auto"><Button variant="primary">{t("events.open_console")}</Button></Link>
      </div>
      <Pills className="mt-6 max-w-full overflow-x-auto" value={tab} onChange={setTab}
        options={(["applications", "members", "map", "vehicles", "settings"] as Tab[]).map((k) => ({ value: k, label: t(`manage.tab.${k}`) }))} />
      <div className="mt-6">
        {tab === "applications" && <Applications eventId={ev.id} />}
        {tab === "members" && <Members ev={ev} />}
        {tab === "map" && <Points ev={ev} onChange={reload} />}
        {tab === "vehicles" && <Vehicles ev={ev} onChange={reload} />}
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
                  <p className="text-sm text-muted">{a.user.email}{a.user.phone ? ` · ${a.user.phone}` : ""}{a.user.country ? ` · ${a.user.country}` : ""}</p>
                  <p className="num text-xs text-muted">{formatDate(locale, a.created_at)}{a.requested_role ? ` · ${t("manage.requested", { role: t(`role.${a.requested_role}`) })}` : ""}</p>
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
    <div>
      <ErrorText>{error}</ErrorText>
      {list === null ? <Spinner /> : list.length === 0 ? <Empty>{t("dash.none")}</Empty> : (
        <div className="overflow-x-auto rounded-[28px] border border-white/[0.06]">
          <table className="w-full text-sm">
            <tbody>
              {list.map((m) => (
                <tr key={m.user_id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{m.first_name} {m.last_name}</p>
                    <p className="text-xs text-muted">{m.email}{m.phone ? ` · ${m.phone}` : ""}</p>
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
  const [draft, setDraft] = useState<{ lat: number; lon: number } | null>(null);
  const { error, busy, run } = useAction();
  useEffect(() => {
    if (map) setEventFeatures(map, [...ev.points, ...(draft ? [{ id: "draft", kind: "meeting", name: "•", ...draft }] : [])], ev.zones);
  }, [map, ev, draft]);
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
          <MapView center={center} zoom={ev.center_lat ? 11 : 8} onReady={setMap} onClick={(p) => setDraft({ lat: +p.lat.toFixed(6), lon: +p.lng.toFixed(6) })} />
        </Card>
        <div className="mt-4 grid gap-2">
          {ev.points.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-[20px] border border-white/[0.06] bg-surface/90 px-4 py-3 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: POINT_COLORS[p.kind] }} />
              <span className="flex-1">{p.name} <span className="text-muted">· {t(`point.${p.kind}`)} · {p.lat.toFixed(4)}, {p.lon.toFixed(4)}</span></span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api.events.deletePoint(ev.id, p.id)).then(onChange)}>{t("common.delete")}</Button>
            </div>
          ))}
        </div>
      </div>
      <Card className="h-fit p-4">
        <p className="font-bold">{t("manage.add_point")}</p>
        <p className="mt-1 text-xs text-muted">{t("manage.add_point_hint")}</p>
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
          <div key={v.id} className="flex items-center gap-3 rounded-[20px] border border-white/[0.06] bg-surface/90 px-5 py-3.5">
            <span className="flex-1 font-medium">{v.name} <span className="text-sm text-muted">{v.plate} · {v.capacity} {t("manage.capacity").toLowerCase()}</span></span>
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
      {ev.invite_code && <p className="mb-5 text-sm">{t("manage.invite_code")}: <code className="rounded bg-raised px-2 py-1 font-bold text-amber">{ev.invite_code}</code></p>}
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
