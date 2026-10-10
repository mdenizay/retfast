"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { EventDetail, Role } from "@retfast/core";
import { MapView, POINT_COLORS, setEventFeatures } from "@/components/map";
import { Badge, Button, Card, ErrorText, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { api, errorCode } from "@/lib/api";
import { formatRange, useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";

export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const { t, err, locale } = useI18n();
  const { user, loading } = useSession();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(() => api.events.get(id).then(setEv).catch((x) => setError(err(errorCode(x)))), [id, err]);
  useEffect(() => {
    if (!loading) void load();
  }, [loading, load, user]);

  if (error) return <main className="mx-auto max-w-3xl px-4 py-16"><ErrorText>{error}</ErrorText></main>;
  if (!ev) return <main className="flex justify-center py-24"><Spinner /></main>;

  const role = ev.membership?.role;
  const staff = role === "event_admin" || role === "observer" || user?.is_system_admin;
  const admin = role === "event_admin" || user?.is_system_admin;
  const center: [number, number] = [ev.center_lon ?? ev.points[0]?.lon ?? 29.3, ev.center_lat ?? ev.points[0]?.lat ?? 37.1];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="kicker">{[ev.city, ev.region, ev.country].filter(Boolean).join(" · ")}</p>
          <h1 className="mt-2 text-3xl font-light tracking-tight sm:text-5xl">{ev.name}</h1>
          <p className="num mt-2 text-muted">{formatRange(locale, ev.starts_at, ev.ends_at)} · {t("events.members", { n: ev.member_count })}</p>
        </div>
        <div className="flex gap-2">
          <Badge tone={ev.status === "active" ? "amber" : "default"}>{t(`status.${ev.status}`)}</Badge>
          {ev.visibility === "private" && <Badge>{t("form.private")}</Badge>}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card className="h-[420px] overflow-hidden">
            <MapView center={center} zoom={ev.center_lat ? 10 : 8} onReady={(m) => setEventFeatures(m, ev.points, ev.zones)} />
          </Card>
          {ev.points.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {ev.points.map((p) => (
                <div key={p.id} className="flex items-start gap-3 rounded-[22px] border border-white/[0.06] bg-surface/90 p-3">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: POINT_COLORS[p.kind] }} />
                  <div className="min-w-0">
                    <p className="font-semibold">{p.name} <span className="text-xs font-normal text-muted">· {t(`point.${p.kind}`)}{p.altitude_m ? ` · ${Math.round(p.altitude_m)} m` : ""}</span></p>
                    {(p.description || p.instructions) && <p className="text-sm text-muted">{p.description} {p.instructions}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {ev.description && <p className="whitespace-pre-line text-muted">{ev.description}</p>}
          {ev.rules_md && (
            <div>
              <p className="kicker">{t("events.rules")}</p>
              <p className="mt-2 whitespace-pre-line text-sm text-muted">{ev.rules_md}</p>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            {role ? (
              <div className="space-y-3">
                <p>{t("events.member_as", { role: t(`role.${role}`) })}</p>
                {staff && <Link href={`/app/events/${ev.id}/live`}><Button variant="primary" className="w-full">{t("events.open_console")}</Button></Link>}
                {admin && <Link href={`/app/events/${ev.id}/manage`}><Button className="mt-2 w-full">{t("events.manage")}</Button></Link>}
                <LeaveButton id={ev.id} onDone={load} />
              </div>
            ) : (
              <>
                {!role && admin && (
                  <div className="mb-4 space-y-2">
                    <Link href={`/app/events/${ev.id}/live`}><Button variant="primary" className="w-full">{t("events.open_console")}</Button></Link>
                    <Link href={`/app/events/${ev.id}/manage`}><Button className="mt-2 w-full">{t("events.manage")}</Button></Link>
                  </div>
                )}
                <ApplyBox ev={ev} onDone={load} />
              </>
            )}
          </Card>
          {Object.keys(ev.contact ?? {}).length > 0 && (
            <Card className="p-5">
              <p className="kicker">{t("events.contact")}</p>
              {Object.entries(ev.contact).map(([k, v]) => <p key={k} className="mt-2 text-sm"><span className="text-muted">{k}:</span> {v}</p>)}
            </Card>
          )}
        </aside>
      </div>
    </main>
  );
}

function ApplyBox({ ev, onDone }: { ev: EventDetail; onDone: () => void }) {
  const { t, err } = useI18n();
  const { user } = useSession();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (!user) {
    return <Link href={`/login?next=/events/${ev.id}`}><Button variant="primary" className="w-full">{t("events.login_to_apply")}</Button></Link>;
  }
  if (ev.application?.status === "pending") return <p className="text-muted">{t("events.applied")}</p>;
  if (!ev.applications_open) return <p className="text-muted">{t("events.applications_closed")}</p>;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      await api.events.apply(ev.id, {
        requested_role: (f.get("role") as Role) || null,
        message: String(f.get("message") ?? ""),
        invite_code: String(f.get("code") ?? "") || undefined,
      });
      onDone();
    } catch (x) {
      setError(err(errorCode(x)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {ev.application?.status === "rejected" && <p className="text-sm text-muted">{t("events.rejected")}</p>}
      <Field label={t("events.apply_as")}>
        <Select name="role" defaultValue="pilot">
          <option value="pilot">{t("role.pilot")}</option>
          <option value="retriever">{t("role.retriever")}</option>
          <option value="observer">{t("role.observer")}</option>
        </Select>
      </Field>
      {ev.visibility === "private" && <Field label={t("events.invite_code")}><Input name="code" required /></Field>}
      <Field label={t("events.apply_message")}><Textarea name="message" maxLength={2000} /></Field>
      <ErrorText>{error}</ErrorText>
      <Button variant="primary" className="w-full" disabled={busy}>{t("events.apply")}</Button>
    </form>
  );
}

function LeaveButton({ id, onDone }: { id: string; onDone: () => void }) {
  const { t, err } = useI18n();
  const [error, setError] = useState<string>();
  return (
    <>
      <Button variant="ghost" className="w-full" onClick={async () => {
        if (!confirm(t("common.confirm"))) return;
        try {
          await api.events.leave(id);
          onDone();
        } catch (x) {
          setError(err(errorCode(x)));
        }
      }}>{t("events.leave")}</Button>
      <ErrorText>{error}</ErrorText>
    </>
  );
}
