import { lazy, Suspense, useState, type FormEvent } from "react";
import type { EventInput } from "@/lib/api/endpoints";
import type { EventSettings, EventStatus, LatLon, RfEvent } from "@/lib/api/types";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { DEFAULT_SETTINGS, SETTING_LABELS } from "./settings";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import { isApiError } from "@/lib/api/client";
import { Field, FormError, Loading, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PointPicker = lazy(() => import("./PointPicker").then((m) => ({ default: m.PointPicker })));

interface FormState {
  name: string;
  slug: string;
  description: string;
  location_name: string;
  starts_at: string;
  ends_at: string;
  visibility: RfEvent["visibility"];
  status: EventStatus;
  lat: string;
  lon: string;
  center_is_approximate: boolean;
  settings: EventSettings;
}

function parseCoord(v: string, max: number): number | null {
  const n = Number(v.trim().replace(",", "."));
  return v.trim() !== "" && Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

function centerOf(s: FormState): LatLon | null {
  const lat = parseCoord(s.lat, 90);
  const lon = parseCoord(s.lon, 180);
  return lat !== null && lon !== null ? { lat, lon } : null;
}

function initialState(e?: RfEvent): FormState {
  return {
    name: e?.name ?? "",
    slug: e?.slug ?? "",
    description: e?.description ?? "",
    location_name: e?.location_name ?? "",
    starts_at: toLocalInput(e?.starts_at),
    ends_at: toLocalInput(e?.ends_at),
    visibility: e?.visibility ?? "public",
    status: e?.status ?? "draft",
    lat: e?.center ? String(e.center.lat) : "",
    lon: e?.center ? String(e.center.lon) : "",
    center_is_approximate: e?.center_is_approximate ?? true,
    settings: { ...DEFAULT_SETTINGS, ...(e?.settings ?? {}) },
  };
}

export function validateEventForm(s: FormState): Partial<Record<keyof FormState, MessageKey>> {
  const errors: Partial<Record<keyof FormState, MessageKey>> = {};
  if (!s.name.trim()) errors.name = "form.required";
  if (s.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.slug)) errors.slug = "eventForm.slugInvalid";
  if (!s.starts_at) errors.starts_at = "form.required";
  if (!s.ends_at) errors.ends_at = "form.required";
  if (s.starts_at && s.ends_at && new Date(s.ends_at) <= new Date(s.starts_at)) errors.ends_at = "eventForm.endsBeforeStart";
  if ((s.lat.trim() || s.lon.trim()) && !centerOf(s)) errors.lat = "eventForm.coordInvalid";
  return errors;
}

export function EventForm({
  event, onSubmit, submitLabel, busy, error,
}: {
  event?: RfEvent;
  onSubmit: (input: EventInput) => void;
  submitLabel: string;
  busy?: boolean;
  error?: unknown;
}) {
  const { t } = useI18n();
  const [s, setS] = useState<FormState>(() => initialState(event));
  const [touched, setTouched] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const errors = touched ? validateEventForm(s) : {};
  const server = isApiError(error) ? error.details : {};
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((p) => ({ ...p, [k]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(validateEventForm(s)).length) return;
    const input: EventInput = {
      name: s.name.trim(),
      description: s.description,
      location_name: s.location_name.trim(),
      starts_at: fromLocalInput(s.starts_at),
      ends_at: fromLocalInput(s.ends_at),
      visibility: s.visibility,
      center: centerOf(s),
      center_is_approximate: s.center_is_approximate,
      settings: { ...s.settings, public_live_map: s.settings.public_live_map && s.settings.live_tracking && s.visibility === "public" },
      kind: "paragliding",
    };
    if (s.slug.trim()) input.slug = s.slug.trim();
    if (event) input.status = s.status;
    onSubmit(input);
  }

  const err = (k: keyof FormState) => (errors[k] ? t(errors[k]!) : (server[k] ?? null));

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Panel title={t("eventForm.basics")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="ev-name" label={t("eventForm.name")} error={err("name")} className="md:col-span-2">
            <Input id="ev-name" value={s.name} onChange={(e) => set("name", e.target.value)} aria-invalid={Boolean(err("name")) || undefined} />
          </Field>
          <Field id="ev-slug" label={t("eventForm.slug")} hint={t("eventForm.slugHint")} error={err("slug")}>
            <Input id="ev-slug" value={s.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} placeholder="cameli-2026" className="telemetry" />
          </Field>
          <Field id="ev-loc" label={t("eventForm.location")} error={err("location_name")}>
            <Input id="ev-loc" value={s.location_name} onChange={(e) => set("location_name", e.target.value)} placeholder="Çameli, Denizli" />
          </Field>
          <Field id="ev-start" label={t("event.starts")} error={err("starts_at")}>
            <Input id="ev-start" type="datetime-local" value={s.starts_at} onChange={(e) => set("starts_at", e.target.value)} />
          </Field>
          <Field id="ev-end" label={t("event.ends")} error={err("ends_at")}>
            <Input id="ev-end" type="datetime-local" value={s.ends_at} onChange={(e) => set("ends_at", e.target.value)} />
          </Field>
          <Field id="ev-desc" label={t("eventForm.description")} className="md:col-span-2">
            <Textarea id="ev-desc" value={s.description} onChange={(e) => set("description", e.target.value)} rows={4} />
          </Field>
          <Field id="ev-vis" label={t("eventForm.visibility")} hint={t(s.visibility === "public" ? "eventForm.visPublicHint" : "eventForm.visRestrictedHint")}>
            <Select value={s.visibility} onValueChange={(v) => set("visibility", v as FormState["visibility"])}>
              <SelectTrigger id="ev-vis" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="public">{t("eventForm.visPublic")}</SelectItem>
                <SelectItem value="restricted">{t("event.restricted")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {event && (
            <Field id="ev-status" label={t("eventForm.status")}>
              <Select value={s.status} onValueChange={(v) => set("status", v as EventStatus)}>
                <SelectTrigger id="ev-status" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["draft", "published", "active", "completed"] as const).map((st) => (
                    <SelectItem key={st} value={st}>{t(`event.status.${st}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
      </Panel>

      <Panel title={t("eventForm.center")}>
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field id="ev-lat" label={t("common.lat")} error={err("lat")}>
            <Input id="ev-lat" inputMode="decimal" className="telemetry" placeholder="37.0700" value={s.lat} onChange={(e) => set("lat", e.target.value)} aria-invalid={Boolean(err("lat")) || undefined} />
          </Field>
          <Field id="ev-lon" label={t("common.lon")}>
            <Input id="ev-lon" inputMode="decimal" className="telemetry" placeholder="29.3400" value={s.lon} onChange={(e) => set("lon", e.target.value)} />
          </Field>
          <Button variant="outline" onClick={() => setShowMap((x) => !x)}>{showMap ? t("eventForm.hideMap") : t("eventForm.pickOnMap")}</Button>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Checkbox id="ev-approx" checked={s.center_is_approximate} onCheckedChange={(c) => set("center_is_approximate", c === true)} />
          <Label htmlFor="ev-approx">{t("eventForm.approximate")}</Label>
        </div>
        {showMap && (
          <div className="mt-4">
            <Suspense fallback={<Loading />}>
              <PointPicker value={centerOf(s)} onChange={(p) => setS((prev) => ({ ...prev, lat: String(p.lat), lon: String(p.lon) }))} label={t("eventForm.pickOnMap")} />
            </Suspense>
          </div>
        )}
      </Panel>

      <Panel title={t("eventForm.settings")} bodyClassName="p-0">
        <ul className="divide-y divide-border">
          {SETTING_LABELS.map(({ key, label, hint }) => (
            <li key={key} className="flex items-center gap-4 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <Label htmlFor={`set-${key}`} className="text-body text-fg">{t(label)}</Label>
                <p className="mt-1 text-caption text-fg-muted">{t(hint)}</p>
              </div>
              <Switch
                id={`set-${key}`}
                checked={s.settings[key]}
                disabled={key === "public_live_map" && (!s.settings.live_tracking || s.visibility === "restricted")}
                onCheckedChange={(c) => set("settings", { ...s.settings, [key]: c })}
              />
            </li>
          ))}
        </ul>
      </Panel>

      <FormError error={error} />
      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={busy}>{busy ? t("common.wait") : submitLabel}</Button>
      </div>
    </form>
  );
}
