import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Download, Eye, MailWarning, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { authApi, meApi } from "@/lib/api/endpoints";
import type { Me, PilotProfile, Preferences } from "@/lib/api/types";
import { session, useSession } from "@/lib/auth";
import { isApiError } from "@/lib/api/client";
import { Field, FormError, PageHeader, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LangToggle, ThemeToggle } from "@/layouts/Preferences";

async function reloadMe() {
  const me = await meApi.get();
  session.setUser(me);
  return me;
}

function Saved({ show }: { show: boolean }) {
  const { t } = useI18n();
  if (!show) return null;
  return <span role="status" className="inline-flex items-center gap-1 text-footnote text-success"><CheckCircle2 className="size-4" aria-hidden />{t("common.saved")}</span>;
}

export default function SettingsPage() {
  const { t } = useI18n();
  const { user } = useSession();
  if (!user) return null;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("settings.title")} subtitle={user.email} />
      <ProfileSection user={user} />
      <PilotSection user={user} />
      <PreferencesSection user={user} />
      <PasswordSection />
      <DataSection user={user} />
    </div>
  );
}

function ProfileSection({ user }: { user: Me }) {
  const { t } = useI18n();
  const [name, setName] = useState(user.full_name);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: async () => { await meApi.update({ full_name: name.trim() }); return reloadMe(); },
    onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2500); },
  });
  const resend = useMutation({ mutationFn: authApi.resendVerification });
  return (
    <Panel title={t("settings.profile")}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <Field id="me-name" label={t("auth.fullName")}><Input id="me-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
        <div className="flex flex-wrap items-center gap-2 text-footnote">
          <span className="text-fg-muted">{t("auth.email")}:</span>
          <span>{user.email}</span>
          {user.email_verified ? <Badge variant="success">{t("settings.verified")}</Badge> : (
            <>
              <Badge variant="warning"><MailWarning aria-hidden />{t("settings.unverified")}</Badge>
              <Button size="sm" variant="ghost" onClick={() => resend.mutate()} disabled={resend.isPending || resend.isSuccess}>
                {resend.isSuccess ? t("settings.verificationSent") : t("settings.resendVerification")}
              </Button>
            </>
          )}
        </div>
        <FormError error={save.error ?? resend.error} />
        <div className="flex items-center gap-3"><Button type="submit" disabled={save.isPending || !name.trim()}>{t("common.save")}</Button><Saved show={saved} /></div>
      </form>
    </Panel>
  );
}

const PILOT_FIELDS = ["display_name", "wing", "license_no", "nationality"] as const;

function PilotSection({ user }: { user: Me }) {
  const { t } = useI18n();
  const p = user.pilot;
  const [form, setForm] = useState<Partial<PilotProfile>>({
    display_name: p?.display_name ?? "", bio: p?.bio ?? "", wing: p?.wing ?? "", license_no: p?.license_no ?? "",
    nationality: p?.nationality ?? "", phone: p?.phone ?? "",
    emergency_contact_name: p?.emergency_contact_name ?? "", emergency_contact_phone: p?.emergency_contact_phone ?? "",
  });
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: async () => { await meApi.updatePilot(form); return reloadMe(); },
    onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2500); },
  });
  const details = isApiError(save.error) ? save.error.details : {};
  const set = (k: keyof PilotProfile, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const labels: Record<(typeof PILOT_FIELDS)[number], string> = {
    display_name: t("pilot.displayName"), wing: t("pilot.wing"), license_no: t("pilot.license"), nationality: t("pilot.nationality"),
  };
  return (
    <Panel title={t("settings.pilot")}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <p className="text-footnote text-fg-secondary">{t("settings.pilotLead")}</p>
        {p?.public_id && (
          <p className="text-footnote text-fg-secondary">
            {t("settings.publicId")}: <span className="telemetry">@{p.public_id}</span>
            {user.preferences.public_profile && <> · <Link to={`/pilots/${p.public_id}`} className="text-primary hover:underline">{t("settings.viewPublic")}</Link></>}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {PILOT_FIELDS.map((k) => (
            <Field key={k} id={`pilot-${k}`} label={labels[k]} error={details[k]}>
              <Input id={`pilot-${k}`} value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
          <Field id="pilot-bio" label={t("pilot.bio")} className="sm:col-span-2"><Textarea id="pilot-bio" value={form.bio ?? ""} onChange={(e) => set("bio", e.target.value)} rows={3} /></Field>
        </div>
        <fieldset className="rounded-md border border-border p-4">
          <legend className="px-1 text-footnote font-semibold">{t("settings.contact")}</legend>
          <Field id="pilot-phone" label={t("settings.phone")} hint={t("settings.phoneHint")} error={details.phone}>
            <Input id="pilot-phone" type="tel" autoComplete="tel" inputMode="tel" className="telemetry sm:w-72" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <VisibilityNote>{t("settings.phoneVisibility")}</VisibilityNote>
        </fieldset>
        <fieldset className="rounded-md border border-border p-4">
          <legend className="px-1 text-footnote font-semibold">{t("pilot.emergencyContact")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="ec-name" label={t("settings.emergencyName")} error={details.emergency_contact_name}><Input id="ec-name" value={form.emergency_contact_name ?? ""} onChange={(e) => set("emergency_contact_name", e.target.value)} /></Field>
            <Field id="ec-phone" label={t("settings.emergencyPhone")} error={details.emergency_contact_phone}><Input id="ec-phone" type="tel" autoComplete="off" inputMode="tel" className="telemetry" value={form.emergency_contact_phone ?? ""} onChange={(e) => set("emergency_contact_phone", e.target.value)} /></Field>
          </div>
          <VisibilityNote>{t("settings.emergencyVisibility")}</VisibilityNote>
        </fieldset>
        <FormError error={save.error} />
        <div className="flex items-center gap-3"><Button type="submit" disabled={save.isPending}>{t("common.save")}</Button><Saved show={saved} /></div>
      </form>
    </Panel>
  );
}

function VisibilityNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2 text-caption text-fg-secondary">
      <Eye className="mt-0.5 size-3.5 shrink-0 text-fg-muted" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function Row({ label, hint, control, id }: { label: string; hint?: string; control: ReactNode; id?: string }) {
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-body text-fg">{label}</Label>
        {hint && <p className="mt-1 text-caption text-fg-muted">{hint}</p>}
      </div>
      {control}
    </div>
  );
}

function PreferencesSection({ user }: { user: Me }) {
  const { t } = useI18n();
  const save = useMutation({
    mutationFn: async (p: Partial<Preferences>) => { await meApi.update({ preferences: p }); return reloadMe(); },
  });
  const prefs = user.preferences;
  return (
    <Panel title={t("settings.preferences")}>
      <div className="divide-y divide-border">
        <Row label={t("theme.label")} control={<ThemeToggle />} />
        <Row label={t("lang.label")} control={<LangToggle />} />
        <Row id="pref-units" label={t("settings.units")} control={
          <Select value={prefs.units} onValueChange={(v) => save.mutate({ units: v as Preferences["units"] })}>
            <SelectTrigger id="pref-units" className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="metric">{t("settings.metric")}</SelectItem><SelectItem value="imperial">{t("settings.imperial")}</SelectItem></SelectContent>
          </Select>
        } />
        <Row id="pref-public" label={t("settings.publicProfile")} hint={t("settings.publicProfileHint")} control={
          <Switch id="pref-public" checked={prefs.public_profile} onCheckedChange={(c) => save.mutate({ public_profile: c })} />
        } />
      </div>
      <FormError error={save.error} />
    </Panel>
  );
}

function PasswordSection() {
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [done, setDone] = useState(false);
  const change = useMutation({
    mutationFn: () => authApi.changePassword(current, pw),
    onSuccess: (res) => { session.setAuth(res); setCurrent(""); setPw(""); setPw2(""); setDone(true); },
  });
  const details = isApiError(change.error) ? change.error.details : {};
  const mismatch = pw2.length > 0 && pw !== pw2;
  return (
    <Panel title={t("settings.password")}>
      <form onSubmit={(e) => { e.preventDefault(); if (pw === pw2 && pw.length >= 10) change.mutate(); }} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="s-cur" label={t("auth.currentPassword")} error={details.current_password}><Input id="s-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
          <Field id="s-new" label={t("auth.newPassword")} error={details.new_password}><Input id="s-new" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field id="s-new2" label={t("auth.confirmPassword")} error={mismatch ? t("auth.mismatch") : null}><Input id="s-new2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        </div>
        <p className="text-caption text-fg-muted">{t("auth.passwordPolicy")} {t("settings.passwordSessions")}</p>
        {!details.new_password && !details.current_password && <FormError error={change.error} />}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={change.isPending || !current || pw.length < 10 || pw !== pw2}>{t("auth.setPassword")}</Button>
          <Saved show={done} />
        </div>
      </form>
    </Panel>
  );
}

function DataSection({ user }: { user: Me }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [deletion, setDeletion] = useState<{ status: string; requested_at: string } | null>(null);
  const exp = useMutation({
    mutationFn: async () => {
      const res = await meApi.exportData();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `retfast-export-${user.id.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  const del = useMutation({
    mutationFn: () => meApi.requestDeletion(reason.trim() || undefined),
    onSuccess: (r) => { setDeletion(r ?? { status: "pending", requested_at: new Date().toISOString() }); setOpen(false); },
  });
  const cancel = useMutation({ mutationFn: meApi.cancelDeletion, onSuccess: () => setDeletion(null) });
  return (
    <Panel title={t("settings.data")}>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-footnote text-fg-secondary">{t("settings.exportHint")}</p>
          <Button variant="outline" onClick={() => exp.mutate()} disabled={exp.isPending}><Download /> {t("settings.export")}</Button>
        </div>
        <FormError error={exp.error} />
        <div className="h-px bg-border" />
        {deletion ? (
          <div role="status" className="space-y-3 rounded-md border border-warning/50 bg-warning/10 p-3 text-footnote">
            <p>{t("settings.deletionPending")}</p>
            <Button variant="outline" size="sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>{t("settings.cancelDeletion")}</Button>
            <FormError error={cancel.error} />
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-footnote text-fg-secondary">{t("settings.deletionHint")}</p>
            <Button variant="destructive" onClick={() => setOpen(true)}><Trash2 /> {t("settings.requestDeletion")}</Button>
          </div>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.deletionTitle")}</DialogTitle>
            <DialogDescription>{t("settings.deletionBody")}</DialogDescription>
          </DialogHeader>
          <label htmlFor="del-reason" className="text-footnote font-medium text-fg-secondary">{t("settings.deletionReason")}</label>
          <Textarea id="del-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          <FormError error={del.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => del.mutate()} disabled={del.isPending}>{t("settings.requestDeletion")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
