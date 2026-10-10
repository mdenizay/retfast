"use client";
import { useState } from "react";
import type { Locale } from "@retfast/core";
import { Button, Card, ErrorText, Field, Input, Select } from "@/components/ui";
import { api, errorCode } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";

export default function ProfilePage() {
  const { t, err } = useI18n();
  const { user, setUser } = useSession();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  if (!user) return null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "");
    try {
      setUser(await api.me.update({
        first_name: s("first_name"), last_name: s("last_name"), phone: s("phone"), country: s("country"),
        locale: s("locale") as Locale, emergency_contact_name: s("ecn"), emergency_contact_phone: s("ecp"),
      }));
      setSaved(true);
      setError(undefined);
    } catch (x) {
      setError(err(errorCode(x)));
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
    <Card className="p-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t("nav.profile")}</h1>
      <p className="text-sm text-label-2">{user.email}</p>
      <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label={t("auth.first_name")}><Input name="first_name" defaultValue={user.first_name} required /></Field>
        <Field label={t("auth.last_name")}><Input name="last_name" defaultValue={user.last_name} required /></Field>
        <Field label={t("form.phone")}><Input name="phone" type="tel" defaultValue={user.phone ?? ""} /></Field>
        <Field label={t("form.country")}><Input name="country" defaultValue={user.country ?? ""} maxLength={2} /></Field>
        <Field label={t("form.language")}>
          <Select name="locale" defaultValue={user.locale}><option value="tr">Türkçe</option><option value="en">English</option></Select>
        </Field>
        <div />
        <Field label={t("form.emergency_name")}><Input name="ecn" defaultValue={user.emergency_contact_name ?? ""} /></Field>
        <Field label={t("form.emergency_phone")}><Input name="ecp" type="tel" defaultValue={user.emergency_contact_phone ?? ""} /></Field>
        <div className="sm:col-span-2">
          <ErrorText>{error}</ErrorText>
          {saved && <p className="mb-2 text-sm text-ok">{t("manage.saved")}</p>}
          <Button variant="primary">{t("common.save")}</Button>
        </div>
      </form>
    </Card>
    <PasswordCard />
    </div>
  );
}

function PasswordCard() {
  const { t, err } = useI18n();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api.me.changePassword({ current_password: String(f.get("current")), new_password: String(f.get("next")) });
      form.reset();
      setDone(true);
      setError(undefined);
    } catch (x) {
      setDone(false);
      setError(err(errorCode(x)));
    }
  }
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">{t("auth.change_password")}</h2>
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label={t("auth.current_password")}><Input name="current" type="password" autoComplete="current-password" required /></Field>
        <Field label={t("auth.new_password")} hint={t("auth.password_hint")}><Input name="next" type="password" autoComplete="new-password" minLength={8} required /></Field>
        <div className="sm:col-span-2">
          <ErrorText>{error}</ErrorText>
          {done && <p className="mb-2 text-sm text-ok">{t("auth.password_changed")}</p>}
          <Button variant="primary">{t("auth.change_password")}</Button>
        </div>
      </form>
    </Card>
  );
}
