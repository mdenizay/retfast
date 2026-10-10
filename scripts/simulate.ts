// Saha simülatörü: sahte pilot ve retriever'lar oluşturur, konum yollar, iner, retrieve ister,
// retriever'lar kabul edip teslim alır. Yerel geliştirme ve yük denemesi içindir.
//
//   bun scripts/simulate.ts --api http://127.0.0.1:3001/v1 --admin root@retfast.test --password '...' \
//       [--event <id>] [--pilots 25] [--retrievers 4] [--speed 10]
//
// --event verilmezse "Çameli XC-Open (simülasyon)" etkinliğini noktalarıyla birlikte oluşturur.
// Sahte hesaplar `sim-*@retfast.test` adreslerini kullanır. Üretim veritabanında çalıştırma.
const args = Object.fromEntries(process.argv.slice(2).reduce<[string, string][]>((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1] ?? ""]] : a), []));
const API = args.api ?? "http://127.0.0.1:3001/v1";
const N = Number(args.pilots ?? 25);
const R = Number(args.retrievers ?? 4);
const SPEED = Number(args.speed ?? 10); // simülasyon hız çarpanı
const PASSWORD = "sim-password-123";
const TAKEOFF = { lat: 37.0567, lon: 29.3622 }; // Çameli, Bozdağ (yaklaşık)

async function call<T = any>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${JSON.stringify(data)}`), { code: data?.error?.code });
  return data;
}

async function account(email: string, first: string, last: string) {
  try {
    return await call("POST", "/auth/register", undefined, { email, password: PASSWORD, first_name: first, last_name: last, locale: "tr" });
  } catch (e: any) {
    if (e.code !== "EMAIL_TAKEN") throw e;
    return call("POST", "/auth/login", undefined, { email, password: PASSWORD });
  }
}

const FIRST = ["Ahmet", "Elif", "Mehmet", "Zeynep", "Can", "Deniz", "Ece", "Burak", "Selin", "Emre", "Ayşe", "Kerem", "Defne", "Murat", "İpek", "Ozan", "Nil", "Barış", "Ceren", "Tolga"];
const LAST = ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Arslan", "Doğan", "Kılıç", "Aydın", "Öztürk"];

const admin = await call("POST", "/auth/login", undefined, { email: args.admin, password: args.password });
let eventId = args.event;
if (!eventId) {
  const now = Date.now();
  const ev = await call("POST", "/events", admin.token, {
    name: "Çameli XC-Open (simülasyon)", status: "active", city: "Çameli", region: "Denizli", country: "TR",
    center_lat: 37.08, center_lon: 29.40, starts_at: new Date(now - 3600_000).toISOString(), ends_at: new Date(now + 3 * 86400_000).toISOString(),
    description: "Simülasyon etkinliği.",
  });
  eventId = ev.id;
  for (const p of [
    { kind: "takeoff", name: "Bozdağ kalkış", lat: TAKEOFF.lat, lon: TAKEOFF.lon, altitude_m: 1850 },
    { kind: "landing", name: "Çameli iniş", lat: 37.0745, lon: 29.3455, altitude_m: 1030 },
    { kind: "meeting", name: "Toplanma – meydan", lat: 37.0718, lon: 29.3436 },
    { kind: "emergency_landing", name: "Acil iniş – tarla", lat: 37.10, lon: 29.45 },
    { kind: "hazard", name: "Enerji hattı", lat: 37.09, lon: 29.42 },
  ]) await call("POST", `/events/${eventId}/points`, admin.token, p);
  await call("POST", `/events/${eventId}/vehicles`, admin.token, { name: "Van 1", plate: "20 RF 001", capacity: 6 });
}
const ev = await call("GET", `/events/${eventId}`, admin.token);
console.log(`event ${eventId} (${ev.name})`);

type Actor = { id: string; token: string; session: string; role: "pilot" | "retriever"; lat: number; lon: number; hdg: number; alt: number; bat: number; phase: string; t: number };
const actors: Actor[] = [];
for (let i = 0; i < N + R; i++) {
  const role = i < N ? "pilot" : "retriever";
  const s = await account(`sim-${role}-${i}@retfast.test`, FIRST[i % FIRST.length]!, LAST[i % LAST.length]!);
  await call("POST", "/me/consent/location", s.token);
  await call("PUT", `/events/${eventId}/members/${s.user.id}`, admin.token, { role, bib: role === "pilot" ? String(100 + i) : null, vehicle_id: role === "retriever" ? ev.vehicles[0]?.id ?? null : null });
  const tr = await call("POST", `/events/${eventId}/tracking/start`, s.token, { platform: "sim" });
  const start = role === "pilot" ? TAKEOFF : { lat: 37.0718 + Math.random() * 0.02, lon: 29.3436 + Math.random() * 0.02 };
  actors.push({ id: s.user.id, token: s.token, session: tr.session_id, role, lat: start.lat, lon: start.lon, hdg: 40 + Math.random() * 80, alt: role === "pilot" ? 1850 : 1000, bat: 70 + Math.round(Math.random() * 30), phase: "ground", t: 0 });
  if (role === "retriever") await call("PUT", `/events/${eventId}/availability`, s.token, { available: true });
}
console.log(`${N} pilots, ${R} retrievers tracking`);

const step = 5; // saniye (simülasyon zamanı)
const buffers = new Map<string, any[]>();
let tick = 0;
setInterval(async () => {
  tick++;
  const live = await call("GET", `/events/${eventId}/live`, admin.token).catch(() => null);
  for (const a of actors) {
    if (a.role === "pilot") {
      const state = live?.members.find((m: any) => m.user_id === a.id)?.pilot_state ?? "preparing";
      if (state === "preparing" && Math.random() < 0.08) {
        await call("POST", `/events/${eventId}/flights/takeoff`, a.token).catch(() => {});
        a.phase = "flying";
      }
      if (a.phase === "flying") {
        a.hdg += (Math.random() - 0.5) * 30;
        const v = 9 + Math.random() * 4; // m/s
        a.lat += (Math.cos((a.hdg * Math.PI) / 180) * v * step * SPEED) / 111_000;
        a.lon += (Math.sin((a.hdg * Math.PI) / 180) * v * step * SPEED) / 89_000;
        a.alt = Math.max(700, a.alt + (Math.random() - 0.55) * 40 * SPEED);
        if (a.alt <= 750 || Math.random() < 0.01) {
          a.phase = "landed";
          const r = Math.random() < 0.85 ? "retrieve" : "self";
          if (r === "retrieve") await call("POST", `/events/${eventId}/retrieves`, a.token, { lat: a.lat, lon: a.lon, note: "Yol kenarındayım" }).catch(() => {});
          else await call("POST", `/events/${eventId}/flights/land`, a.token, { lat: a.lat, lon: a.lon }).catch(() => {});
        }
      }
      if (state === "picked_up" || state === "retriever_assigned") {
        const req = live.retrieves.find((r: any) => r.pilot_id === a.id);
        const drv = req && actors.find((x) => x.id === req.retriever_id);
        if (drv && state === "picked_up") Object.assign(a, { lat: drv.lat, lon: drv.lon });
      }
      if (tick % 3 === 0 && a.id === actors[0]!.id && Math.random() < 0.02) {
        await call("POST", `/events/${eventId}/sos`, a.token, { lat: a.lat, lon: a.lon, message: "Ağaca takıldım" }).catch(() => {});
      }
    } else {
      // Retriever: açık talebi kabul et, oraya sür, al, bırak.
      const mine = live?.retrieves.filter((r: any) => r.retriever_id === a.id) ?? [];
      if (mine.length === 0) {
        const open = live?.retrieves.find((r: any) => r.status === "open");
        if (open && Math.random() < 0.3) await call("POST", `/retrieves/${open.id}/accept`, a.token).catch(() => {});
      }
      const target = mine.find((r: any) => r.status !== "picked_up") ?? mine[0];
      if (target) {
        const dLat = target.lat - a.lat, dLon = target.lon - a.lon, d = Math.hypot(dLat * 111_000, dLon * 89_000);
        const move = 15 * step * SPEED;
        if (target.status === "picked_up") {
          if (Math.random() < 0.15) await call("POST", `/retrieves/${target.id}/complete`, a.token).catch(() => {});
        } else if (d < move) {
          Object.assign(a, { lat: target.lat, lon: target.lon });
          await call("POST", `/retrieves/${target.id}/${target.status === "assigned" ? "arrived" : "picked-up"}`, a.token).catch(() => {});
        } else {
          const f = move / d; // hedefe doğru ilerle
          a.lat += dLat * f;
          a.lon += dLon * f;
        }
        a.hdg = (Math.atan2(dLon * 89_000, dLat * 111_000) * 180) / Math.PI;
      }
    }
    if (Math.random() < 0.01) a.bat = Math.max(5, a.bat - 1);
    const buf = buffers.get(a.id) ?? [];
    buf.push({ t: Date.now(), lat: a.lat, lon: a.lon, alt: a.alt, spd: a.phase === "flying" ? 11 : 0, hdg: ((a.hdg % 360) + 360) % 360, acc: 4 + Math.random() * 6, bat: a.bat });
    buffers.set(a.id, buf);
    // Gerçek cihaz gibi parti halinde yükle.
    if (buf.length >= 3) {
      buffers.set(a.id, []);
      await call("POST", `/events/${eventId}/tracking/points`, a.token, { session_id: a.session, points: buf }).catch((e) => console.error(e.message));
    }
  }
}, (step * 1000) / Math.max(1, SPEED / 2));
