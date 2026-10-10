"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { MyEvents, Notification } from "@retfast/core";
import { Badge, Button, Card, Empty, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatRange, useI18n } from "@/lib/i18n";

export default function Dashboard() {
  const { t, locale } = useI18n();
  const [mine, setMine] = useState<MyEvents | null>(null);
  const [notes, setNotes] = useState<Notification[]>([]);

  useEffect(() => {
    void api.me.events().then(setMine);
    void api.me.notifications().then((r) => setNotes(r.data));
  }, []);

  if (!mine) return <div className="flex justify-center py-24"><Spinner /></div>;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">{t("dash.title")}</h1>
        {mine.memberships.length === 0 && <Empty>{t("dash.none")} <Link href="/#events" className="text-tint">{t("landing.cta_events")}</Link></Empty>}
        <div className="mt-4 grid gap-3">
          {mine.memberships.map(({ role, event: e }) => (
            <Card key={e.id} className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link href={`/events/${e.id}`} className="truncate text-lg font-bold hover:text-tint">{e.name}</Link>
                  <Badge tone={e.status === "active" ? "amber" : "default"}>{t(`status.${e.status}`)}</Badge>
                </div>
                <p className="num text-sm text-label-2">{formatRange(locale, e.starts_at, e.ends_at)} · {t(`role.${role}`)}</p>
              </div>
              {(role === "observer" || role === "event_admin") && (
                <Link href={`/app/events/${e.id}/live`}><Button variant="primary">{t("events.open_console")}</Button></Link>
              )}
              {role === "event_admin" && <Link href={`/app/events/${e.id}/manage`}><Button>{t("events.manage")}</Button></Link>}
            </Card>
          ))}
        </div>
        {mine.applications.length > 0 && (
          <>
            <p className="kicker mt-10">{t("dash.applications")}</p>
            <div className="mt-3 grid gap-2">
              {mine.applications.map((a) => (
                <Link key={a.id} href={`/events/${a.event.id}`} className="flex items-center justify-between rounded-[22px] border border-hair bg-surface px-4 py-3 hover:border-tint/50">
                  <span>{a.event.name}</span>
                  <Badge tone={a.status === "rejected" ? "danger" : "default"}>{a.status === "pending" ? t("manage.pending") : t("events.rejected")}</Badge>
                </Link>
              ))}
            </div>
          </>
        )}
      </section>
      <aside>
        <div className="flex items-center justify-between">
          <p className="kicker">{t("dash.notifications")}</p>
          {notes.some((n) => !n.read_at) && (
            <button className="text-xs text-tint" onClick={() => api.me.readNotifications().then(() => setNotes((n) => n.map((x) => ({ ...x, read_at: x.read_at ?? "now" }))))}>
              {t("dash.mark_read")}
            </button>
          )}
        </div>
        {notes.length === 0 && <Empty>{t("dash.no_notifications")}</Empty>}
        <div className="mt-3 space-y-2">
          {notes.slice(0, 30).map((n) => (
            <div key={n.id} className={`rounded-[20px] border px-4 py-3 text-sm ${n.read_at ? "border-hair text-label-2" : "border-tint/50"}`}>
              <p>{notificationText(n, t)}</p>
              <p className="num text-xs text-label-2">{formatDate(locale, n.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function notificationText(n: Notification, t: ReturnType<typeof useI18n>["t"]): string {
  const p = n.payload as Record<string, string | null>;
  switch (n.kind) {
    case "application.decided":
      return p.status === "accepted" ? t("events.member_as", { role: t(`role.${p.role as "pilot"}`) }) : t("events.rejected");
    case "member.role":
      return t("events.member_as", { role: t(`role.${p.role as "pilot"}`) });
    case "retrieve.requested":
      return t("pilot.awaiting_retrieve");
    case "sos.raised":
      return t("live.sos");
    default: {
      const key = n.kind.replace("retrieve.", "retrieve.") as "retrieve.assigned";
      return t(key) ?? n.kind;
    }
  }
}
