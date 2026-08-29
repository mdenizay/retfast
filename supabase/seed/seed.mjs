// RETFAST development seed — "Çameli XC-Open 2026"
//
// Idempotent: re-running updates/reuses existing rows keyed by email/name.
// Uses the service-role key (bypasses RLS) — dev/staging only.
//
//   cd supabase/seed && npm install && cp .env.example .env  # fill values
//   npm run seed

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (see .env.example)");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const PASSWORD = "retfast2026";
const USERS = [
  { email: "admin@retfast.test", name: "Sistem Admin", systemAdmin: true, roles: [] },
  { email: "orga@retfast.test", name: "Deniz Organizatör", roles: ["event_admin"] },
  { email: "observer@retfast.test", name: "Oya Gözlemci", roles: ["observer"] },
  { email: "pilot1@retfast.test", name: "Pelin Pilot", roles: ["pilot"] },
  { email: "pilot2@retfast.test", name: "Poyraz Pilot", roles: ["pilot"] },
  { email: "pilot3@retfast.test", name: "Pamir Pilot", roles: ["pilot"] },
  { email: "ret1@retfast.test", name: "Rüzgar Toplayıcı", roles: ["retriever"] },
  { email: "ret2@retfast.test", name: "Rana Toplayıcı", roles: ["retriever"] },
];

const ewkt = (lat, lng) => `SRID=4326;POINT(${lng} ${lat})`;

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
    // look the user up by paging (fine at seed scale)
    const { data } = await db.auth.admin.listUsers({ perPage: 200 });
    id = data.users.find((u) => u.email === email)?.id;
    if (!id) throw new Error(`could not find existing user ${email}`);
  }
  const { error: pErr } = await db
    .from("profiles")
    .upsert({ id, display_name: name, locale: "tr", is_system_admin: !!systemAdmin });
  if (pErr) throw pErr;
  return id;
}

function must({ data, error }) {
  if (error) throw error;
  return data;
}

async function main() {
  console.log("→ users");
  const ids = {};
  for (const u of USERS) ids[u.email] = await ensureUser(u);

  console.log("→ event");
  const existing = must(
    await db.from("events").select("id").eq("name", "Çameli XC-Open 2026").maybeSingle()
  );
  const event = existing
    ? must(await db.from("events").select("*").eq("id", existing.id).single())
    : must(
        await db
          .from("events")
          .insert({
            name: "Çameli XC-Open 2026",
            description:
              "Çameli (Denizli) üzerinde XC açık mesafe yarışması. Kalkış: Bozdağ; hedef: Çameli stadyumu.",
            starts_at: "2026-09-05T06:00:00Z",
            ends_at: "2026-09-13T18:00:00Z",
            visibility: "public",
            settings: { timezone: "Europe/Istanbul", languages: ["tr", "en"] },
            created_by: ids["admin@retfast.test"],
          })
          .select()
          .single()
      );
  must(await db.from("event_invite_codes").upsert({ event_id: event.id, code: "CAMELI26" }));
  console.log(`   event ${event.id} (invite code CAMELI26)`);

  console.log("→ memberships");
  for (const u of USERS) {
    for (const role of u.roles) {
      must(
        await db
          .from("event_members")
          .upsert(
            { event_id: event.id, user_id: ids[u.email], role, added_by: ids["admin@retfast.test"] },
            { onConflict: "event_id,user_id,role" }
          )
      );
      if (role === "retriever") {
        must(
          await db.from("retriever_profiles").upsert({
            event_id: event.id,
            user_id: ids[u.email],
            availability: "available",
            vehicle_capacity: u.email === "ret1@retfast.test" ? 4 : 6,
            vehicle_description: u.email === "ret1@retfast.test" ? "Beyaz Transporter" : "Minibüs (gri)",
            last_geom: ewkt(37.052, 29.335),
            last_seen_at: new Date().toISOString(),
          })
        );
      }
    }
  }

  // A pending participation request for the admins to approve in the UI.
  // (Plain select+insert: the pending-uniqueness is a partial index, which
  // PostgREST upsert cannot arbitrate on.)
  const existingReq = must(
    await db
      .from("participation_requests")
      .select("id")
      .eq("event_id", event.id)
      .eq("user_id", ids["pilot3@retfast.test"])
      .eq("requested_role", "retriever")
      .eq("status", "pending")
      .maybeSingle()
  );
  if (!existingReq) {
    must(
      await db.from("participation_requests").insert({
        event_id: event.id,
        user_id: ids["pilot3@retfast.test"],
        requested_role: "retriever",
        message: "İkinci araçla da destek verebilirim.",
      })
    );
  }

  console.log("→ zones");
  const zones = [
    {
      name: "Bozdağ Kalkış",
      zone_type: "takeoff",
      geometry: {
        type: "Polygon",
        coordinates: [[[29.298, 37.098], [29.304, 37.098], [29.304, 37.094], [29.298, 37.094], [29.298, 37.098]]],
      },
      properties: { altitude_m: 1830, direction: "SW" },
    },
    {
      name: "Stadyum İniş / Hedef",
      zone_type: "landing",
      geometry: {
        type: "Polygon",
        coordinates: [[[29.336, 37.033], [29.340, 37.033], [29.340, 37.030], [29.336, 37.030], [29.336, 37.033]]],
      },
      properties: { goal: true },
    },
    {
      name: "Yasak Bölge — Enerji Hattı",
      zone_type: "restricted",
      geometry: {
        type: "Polygon",
        coordinates: [[[29.315, 37.06], [29.325, 37.062], [29.327, 37.055], [29.317, 37.053], [29.315, 37.06]]],
      },
      properties: { reason: "high-voltage line", max_altitude_m: 0 },
    },
    {
      name: "Dönüş Noktası 1",
      zone_type: "checkpoint",
      geometry: { type: "Point", coordinates: [29.36, 37.07] },
      properties: { radius_m: 400, order: 1 },
    },
  ];
  for (const z of zones) {
    const found = must(
      await db.from("geo_zones").select("id").eq("event_id", event.id).eq("name", z.name).maybeSingle()
    );
    if (!found) {
      must(
        await db
          .from("geo_zones")
          .insert({ ...z, event_id: event.id, created_by: ids["orga@retfast.test"] })
      );
    }
  }

  console.log("→ flights + tracks");
  // pilot1: a completed flight with a full replayable track (takeoff → goal)
  const flightStart = Date.parse("2026-09-06T08:30:00Z");
  let task1 = must(
    await db
      .from("tasks")
      .select("id")
      .eq("event_id", event.id)
      .eq("pilot_id", ids["pilot1@retfast.test"])
      .eq("title", "Görev 1 — hedef uçuşu")
      .maybeSingle()
  );
  if (!task1) {
    task1 = must(
      await db
        .from("tasks")
        .insert({
          event_id: event.id,
          pilot_id: ids["pilot1@retfast.test"],
          title: "Görev 1 — hedef uçuşu",
          status: "completed",
          started_at: new Date(flightStart).toISOString(),
          landed_at: new Date(flightStart + 52 * 60_000).toISOString(),
          finished_at: new Date(flightStart + 75 * 60_000).toISOString(),
        })
        .select()
        .single()
    );
    // Synthetic 52-minute track: Bozdağ (1830m) gliding to the stadium.
    const points = [];
    const n = 104; // every 30 s
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const lat = 37.096 + (37.0315 - 37.096) * t + 0.003 * Math.sin(i / 5);
      const lng = 29.301 + (29.338 - 29.301) * t + 0.004 * Math.cos(i / 7);
      points.push({
        id: crypto.randomUUID(),
        event_id: event.id,
        user_id: ids["pilot1@retfast.test"],
        task_id: task1.id,
        recorded_at: new Date(flightStart + i * 30_000).toISOString(),
        geom: ewkt(lat, lng),
        altitude_m: Math.round(1830 - 1000 * t + 220 * Math.sin(i / 6) * (1 - t)),
        heading_deg: (140 + 25 * Math.sin(i / 4) + 360) % 360,
        speed_mps: 9 + 3 * Math.sin(i / 3),
        h_accuracy_m: 5,
        v_accuracy_m: 8,
        battery_pct: Math.max(20, 96 - Math.floor(i / 2)),
        tracking_state: "background",
      });
    }
    for (let i = 0; i < points.length; i += 50) {
      must(await db.from("location_points").insert(points.slice(i, i + 50)));
    }
  }

  // pilot2: landed out, retrieval in progress
  let task2 = must(
    await db
      .from("tasks")
      .select("id")
      .eq("event_id", event.id)
      .eq("pilot_id", ids["pilot2@retfast.test"])
      .eq("title", "Görev 1 — vadi dışı iniş")
      .maybeSingle()
  );
  if (!task2) {
    const start2 = Date.now() - 40 * 60_000;
    task2 = must(
      await db
        .from("tasks")
        .insert({
          event_id: event.id,
          pilot_id: ids["pilot2@retfast.test"],
          title: "Görev 1 — vadi dışı iniş",
          status: "landed",
          started_at: new Date(start2).toISOString(),
          landed_at: new Date(start2 + 35 * 60_000).toISOString(),
        })
        .select()
        .single()
    );
    must(
      await db.from("location_points").insert({
        id: crypto.randomUUID(),
        event_id: event.id,
        user_id: ids["pilot2@retfast.test"],
        task_id: task2.id,
        recorded_at: new Date(start2 + 35 * 60_000).toISOString(),
        geom: ewkt(37.058, 29.395),
        altitude_m: 1120,
        speed_mps: 0,
        battery_pct: 61,
        tracking_state: "background",
      })
    );
    const req = must(
      await db
        .from("retrieval_requests")
        .insert({
          event_id: event.id,
          task_id: task2.id,
          pilot_id: ids["pilot2@retfast.test"],
          retriever_id: ids["ret1@retfast.test"],
          status: "accepted",
          responded_at: new Date().toISOString(),
        })
        .select()
        .single()
    );
    must(
      await db
        .from("retrieval_assignments")
        .insert({
          event_id: event.id,
          task_id: task2.id,
          pilot_id: ids["pilot2@retfast.test"],
          retriever_id: ids["ret1@retfast.test"],
          request_id: req.id,
          status: "en_route",
          en_route_at: new Date().toISOString(),
        })
    );
  }

  console.log("→ sample emergency (resolved)");
  const em = must(
    await db
      .from("emergency_events")
      .select("id")
      .eq("event_id", event.id)
      .eq("message", "Sert iniş, yardım gerekebilir (tatbikat kaydı)")
      .maybeSingle()
  );
  if (!em) {
    must(
      await db.from("emergency_events").insert({
        event_id: event.id,
        user_id: ids["pilot1@retfast.test"],
        geom: ewkt(37.045, 29.36),
        message: "Sert iniş, yardım gerekebilir (tatbikat kaydı)",
        status: "resolved",
        acknowledged_by: ids["observer@retfast.test"],
        acknowledged_at: new Date().toISOString(),
        resolved_by: ids["orga@retfast.test"],
        resolved_at: new Date().toISOString(),
      })
    );
  }

  console.log("\nSeed complete ✔");
  console.log(`Event: Çameli XC-Open 2026 — invite code CAMELI26`);
  console.log(`Users (password ${PASSWORD}):`);
  for (const u of USERS) console.log(`  ${u.email}  ${u.systemAdmin ? "[system admin]" : u.roles.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
