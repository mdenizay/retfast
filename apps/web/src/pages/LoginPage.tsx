import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/i18n";
import { MapPin, Navigation, Route } from "lucide-react";

export default function LoginPage() {
  const { m, locale } = useI18n();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/events");
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName, locale } },
        });
        if (error) throw error;
        if (data.session) navigate("/events");
        else toast.info(m.auth.checkEmail);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : m.common.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(to_right,rgba(243,167,18,.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(243,167,18,.08)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="pointer-events-none absolute left-[12%] top-[18%] hidden items-center gap-3 text-primary/35 lg:flex">
        <MapPin className="size-7" /><span className="h-px w-36 bg-primary/30" /><Route className="size-7" />
      </div>
      <Card className="glass-panel relative w-full max-w-md">
        <CardHeader className="items-center gap-3 pb-2 pt-3 text-center">
          <span className="grid size-14 place-items-center rounded-2xl border border-white/15 bg-black text-white shadow-xl shadow-black/30">
            <Navigation className="size-7 fill-current" />
          </span>
          <div>
            <div className="brand-kicker mb-1">LIVE FLIGHT OPERATIONS</div>
            <CardTitle className="brand-wordmark text-3xl">
              RET<span className="text-primary">FAST</span>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="name">{m.auth.displayName}</Label>
                <Input
                  id="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">{m.auth.email}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{m.auth.password}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {mode === "signin" ? m.auth.signIn : m.auth.signUp}
            </Button>
          </form>
          <button
            type="button"
            className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? m.auth.noAccount : m.auth.haveAccount}{" "}
            <span className="font-medium underline">
              {mode === "signin" ? m.auth.signUp : m.auth.signIn}
            </span>
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
