import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/auth/AuthProvider";
import { LOCALES, useI18n, type Locale } from "@/i18n";
import { supabase } from "@/lib/supabase";

export default function ProfilePage() {
  const { m, setLocale } = useI18n();
  const { profile, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [locale, setLocaleField] = useState<Locale>("en");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name);
      setPhone(profile.phone ?? "");
      setLocaleField((profile.locale as Locale) ?? "en");
    }
  }, [profile]);

  async function save() {
    if (!profile) return;
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName, phone: phone || null, locale })
      .eq("id", profile.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      setLocale(locale);
      await refreshProfile();
      toast.success(m.profile.saved);
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>{m.profile.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{m.auth.displayName}</Label>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Telefon</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>{m.common.language}</Label>
          <Select value={locale} onValueChange={(v) => setLocaleField(v as Locale)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((l) => (
                <SelectItem key={l} value={l}>
                  {l === "en" ? "English" : "Türkçe"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={save} disabled={busy} className="w-full">
          {m.common.save}
        </Button>
      </CardContent>
    </Card>
  );
}
