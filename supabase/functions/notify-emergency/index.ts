// Edge Function: fan out an emergency to event operators via Resend email.
// Deploy:  supabase functions deploy notify-emergency
// Env:     RESEND_API_KEY, EMERGENCY_FROM (e.g. "RETFAST <alerts@retfast.com>")
//
// Invoked by clients right after a successful raise_emergency() RPC:
//   POST /functions/v1/notify-emergency  { "emergency_id": "<uuid>" }
// The caller's JWT is forwarded; we verify with the service role that the
// caller actually raised (or can see) the emergency, so this endpoint cannot
// be used to spam arbitrary users.
//
// Push notifications (APNs) are intentionally not implemented here yet: they
// require an APNs auth key. When added, fan out to `devices.push_token` for
// the same recipient set. See docs/architecture.md §3.

import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return new Response("unauthorized", { status: 401 });

  const { emergency_id } = await req.json().catch(() => ({}));
  if (!emergency_id) return new Response("emergency_id required", { status: 400 });

  const { data: em, error } = await admin
    .from("emergency_events")
    .select("id, event_id, user_id, message, created_at, status")
    .eq("id", emergency_id)
    .single();
  if (error || !em) return new Response("not found", { status: 404 });

  // Only the raiser or an event member may trigger the fanout.
  const { count } = await admin
    .from("event_members")
    .select("id", { count: "exact", head: true })
    .eq("event_id", em.event_id)
    .eq("user_id", caller.user.id);
  if (em.user_id !== caller.user.id && !count) {
    return new Response("forbidden", { status: 403 });
  }

  const [{ data: event }, { data: raiser }, { data: operators }] = await Promise.all([
    admin.from("events").select("name").eq("id", em.event_id).single(),
    admin.from("profiles").select("display_name").eq("id", em.user_id).single(),
    admin
      .from("event_members")
      .select("user_id, role")
      .eq("event_id", em.event_id)
      .in("role", ["event_admin", "observer"]),
  ]);

  const recipientIds = [...new Set((operators ?? []).map((m) => m.user_id))];
  const emails: string[] = [];
  for (const id of recipientIds) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) emails.push(data.user.email);
  }

  // In-app notifications for the same set.
  if (recipientIds.length) {
    await admin.from("notifications").insert(
      recipientIds.map((user_id) => ({
        user_id,
        type: "emergency",
        title: `SOS — ${event?.name ?? "event"}`,
        body: `${raiser?.display_name ?? "A member"}: ${em.message || "emergency signal"}`,
        payload: { emergency_id: em.id, event_id: em.event_id },
      })),
    );
  }

  let emailed = 0;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey && emails.length) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("EMERGENCY_FROM") ?? "RETFAST <alerts@retfast.com>",
        to: emails,
        subject: `🆘 SOS — ${event?.name ?? "RETFAST event"}`,
        text:
          `${raiser?.display_name ?? "A member"} raised an emergency at ${em.created_at}.\n\n` +
          `Message: ${em.message || "(none)"}\n\n` +
          `Open the operations dashboard: https://panel.retfast.com/events/${em.event_id}/ops`,
      }),
    });
    if (res.ok) emailed = emails.length;
  }

  return Response.json({ ok: true, notified: recipientIds.length, emailed });
});
