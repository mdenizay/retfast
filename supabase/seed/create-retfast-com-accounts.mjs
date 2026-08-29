// One-off: create a clean set of demo accounts under the real retfast.com
// domain (one per role) for App Store review / stakeholder demos, alongside
// the existing @retfast.test seed accounts. Idempotent.
//
//   cd supabase/seed && node create-retfast-com-accounts.mjs

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (see .env.example)");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const PASSWORD = "Retfast2026!";
const USERS = [
  { email: "admin@retfast.com", name: "Sistem Admin", systemAdmin: true, roles: [] },
  { email: "orga@retfast.com", name: "Etkinlik Yöneticisi", roles: ["event_admin"] },
  { email: "observer@retfast.com", name: "Gözlemci", roles: ["observer"] },
  { email: "pilot@retfast.com", name: "Pilot", roles: ["pilot"] },
  { email: "retriever@retfast.com", name: "Toplayıcı", roles: ["retriever"] },
];

function must({ data, error }) {
  if (error) throw error;
  return data;
}

async function ensureUser({ email, name, systemAdmin }) {
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: name, locale: "tr" },
  });
  let id = created?.user?.id;
  if (error) {
    if (!/already|exists/i.test(error.message)) throw error;
    const { data } = await db.auth.admin.listUsers({ perPage: 200 });
    id = data.users.find((u) => u.email === email)?.id;
    if (!id) throw new Error(`could not find existing user ${email}`);
  }
  must(
    await db
      .from("profiles")
      .upsert({ id, display_name: name, locale: "tr", is_system_admin: !!systemAdmin })
  );
  return id;
}

async function main() {
  console.log("→ users");
  const ids = {};
  for (const u of USERS) ids[u.email] = await ensureUser(u);

  const event = must(
    await db.from("events").select("id").eq("name", "Çameli XC-Open 2026").single()
  );

  console.log("→ memberships");
  for (const u of USERS) {
    for (const role of u.roles) {
      must(
        await db
          .from("event_members")
          .upsert(
            { event_id: event.id, user_id: ids[u.email], role, added_by: ids["admin@retfast.com"] },
            { onConflict: "event_id,user_id,role" }
          )
      );
      if (role === "retriever") {
        must(
          await db.from("retriever_profiles").upsert({
            event_id: event.id,
            user_id: ids[u.email],
            availability: "available",
            vehicle_capacity: 4,
            vehicle_description: "Beyaz VW Transporter",
            last_geom: "SRID=4326;POINT(29.335 37.052)",
            last_seen_at: new Date().toISOString(),
          })
        );
      }
    }
  }

  console.log("\nDone ✔");
  console.log(`Password for all: ${PASSWORD}`);
  for (const u of USERS) console.log(`  ${u.email}  ${u.systemAdmin ? "[system admin]" : u.roles.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
