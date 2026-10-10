"use client";
import type { EventDetail } from "@retfast/core";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";

function localInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function EventForm({ ev, onSubmit, busy, children }: {
  ev?: Partial<EventDetail>; onSubmit: (body: Record<string, unknown>) => void; busy: boolean; children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const { user } = useSession();
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const iso = (k: string) => (f.get(k) ? new Date(String(f.get(k))).toISOString() : undefined);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : undefined);
    onSubmit({
      name: f.get("name"), description: f.get("description"), city: f.get("city") || undefined, country: f.get("country") || undefined,
      region: f.get("region") || undefined, starts_at: iso("starts_at"), ends_at: iso("ends_at"),
      center_lat: num("center_lat"), center_lon: num("center_lon"), visibility: f.get("visibility"), status: f.get("status"),
      applications_open_at: iso("applications_open_at"), applications_close_at: iso("applications_close_at"),
      applications_closed: f.get("applications_closed") === "on", rules_md: f.get("rules_md"),
    });
  }
  const statuses: EventDetail["status"][] = ["draft", "published", "active", "completed", ...(user?.is_system_admin ? (["archived"] as const) : [])];
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><Field label={t("form.name")}><Input name="name" required defaultValue={ev?.name} maxLength={160} /></Field></div>
      <Field label={t("form.starts_at")}><Input name="starts_at" type="datetime-local" required defaultValue={localInput(ev?.starts_at)} /></Field>
      <Field label={t("form.ends_at")}><Input name="ends_at" type="datetime-local" required defaultValue={localInput(ev?.ends_at)} /></Field>
      <Field label={t("form.city")}><Input name="city" defaultValue={ev?.city ?? ""} /></Field>
      <Field label={t("form.country")}><Input name="country" defaultValue={ev?.country ?? ""} placeholder="TR" maxLength={2} /></Field>
      <Field label={t("form.latitude")}><Input name="center_lat" type="number" step="any" defaultValue={ev?.center_lat ?? ""} /></Field>
      <Field label={t("form.longitude")}><Input name="center_lon" type="number" step="any" defaultValue={ev?.center_lon ?? ""} /></Field>
      <Field label={t("form.visibility")}>
        <Select name="visibility" defaultValue={ev?.visibility ?? "public"}>
          <option value="public">{t("form.public")}</option>
          <option value="private">{t("form.private")}</option>
        </Select>
      </Field>
      <Field label={t("manage.status")}>
        <Select name="status" defaultValue={ev?.status ?? "draft"}>{statuses.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}</Select>
      </Field>
      <Field label={`${t("dash.applications")} · ${t("form.starts_at")}`}><Input name="applications_open_at" type="datetime-local" defaultValue={localInput(ev?.applications_open_at)} /></Field>
      <Field label={`${t("dash.applications")} · ${t("form.ends_at")}`}><Input name="applications_close_at" type="datetime-local" defaultValue={localInput(ev?.applications_close_at)} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="applications_closed" defaultChecked={ev?.applications_closed} className="accent-amber" /> {t("events.applications_closed")}
      </label>
      <div className="sm:col-span-2"><Field label={t("form.description")}><Textarea name="description" defaultValue={ev?.description ?? ""} /></Field></div>
      <div className="sm:col-span-2"><Field label={t("events.rules")}><Textarea name="rules_md" defaultValue={ev?.rules_md ?? ""} /></Field></div>
      <div className="sm:col-span-2">{children}<Button variant="primary" disabled={busy}>{t("common.save")}</Button></div>
    </form>
  );
}

