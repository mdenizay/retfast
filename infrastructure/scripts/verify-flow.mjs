#!/usr/bin/env node
// End-to-end verification of the event + retrieval workflow against a real deployment.
// Uses throwaway accounts (qa-*@example.com). The admin account must be promoted to
// platform_admin out of band (DB) before step "admin creates event" — pass its email via QA_ADMIN.
//
// Usage: API=https://api.retfast.com node verify-flow.mjs register   # creates qa accounts, prints admin email
//        API=https://api.retfast.com QA_RUN=<id> node verify-flow.mjs run
const API = (process.env.API || "http://localhost:8080") + "/api/v1";
const WS = API.replace(/^http/, "ws") + "/realtime";
const RUN = process.env.QA_RUN || Date.now().toString(36);
const PW = `Qa-verify-${RUN}-long`;
const who = (r) => `qa-${r}-${RUN}@example.com`;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

async function login(email) {
  const r = await call("POST", "/auth/login", null, { email, password: PW, client: "ios", device_name: "qa" });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.access_token;
}

function wsClient(token, channels) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const msgs = [];
    const t = setTimeout(() => reject(new Error("ws timeout")), 15000);
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", access_token: token }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      msgs.push(m);
      if (m.type === "auth_ok") channels.forEach((c) => ws.send(JSON.stringify({ type: "subscribe", channel: c })));
      if (m.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
      if (m.type === "subscribed" && msgs.filter((x) => x.type === "subscribed").length === channels.length) {
        clearTimeout(t);
        resolve({ ws, msgs });
      }
    };
    ws.onerror = (e) => reject(e.error || new Error("ws error"));
  });
}
const waitFor = async (msgs, pred, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const m = msgs.find(pred);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
};

async function register() {
  for (const r of ["admin", "pilot", "observer", "retriever", "retriever2"]) {
    let res;
    for (;;) {
      res = await call("POST", "/auth/register", null, { email: who(r), password: PW, full_name: `QA ${r} ${RUN}` });
      if (res.status !== 429) break;
      const wait = Number(res.json?.error?.details?.retry_after || 0) || 15;
      console.log(`rate limited, waiting ${wait}s`);
      await new Promise((ok) => setTimeout(ok, wait * 1000));
    }
    check(`register ${r}`, res.status === 201, `status ${res.status}, roles ${JSON.stringify(res.json?.user?.roles)}`);
  }
  console.log(`QA_RUN=${RUN} QA_ADMIN=${who("admin")}`);
}

async function run() {
  const admin = await login(who("admin"));
  const me = await call("GET", "/me", admin);
  check("admin has platform_admin", me.json?.roles?.includes("platform_admin"));

  const pilot = await login(who("pilot"));
  const observer = await login(who("observer"));
  const retriever = await login(who("retriever"));
  const retriever2 = await login(who("retriever2"));

  const denied = await call("POST", "/events", pilot, { name: "x" });
  check("non-admin cannot create event", denied.status === 403, `status ${denied.status}`);

  const now = new Date();
  const ev = await call("POST", "/events", admin, {
    name: `QA verification ${RUN}`, description: "Automated deployment verification", kind: "paragliding",
    visibility: "public", status: "active", location_name: "QA",
    starts_at: new Date(now - 3600e3).toISOString(), ends_at: new Date(+now + 86400e3).toISOString(),
    center: { lat: 37.0747, lon: 29.345 },
    settings: { applications_open: true, live_tracking: true, public_live_map: false, pilots_see_each_other: true, landing_prompt: true },
  });
  check("admin creates event", ev.status === 201, `status ${ev.status}`);
  const eid = ev.json.id;
  const org = await call("POST", `/events/${eid}/organizers`, admin, { user_id: me.json.id });
  check("admin assigns organizer", [200, 201, 204].includes(org.status), `status ${org.status}`);

  const roles = { pilot, observer, retriever, retriever2 };
  const grant = { pilot: "pilot", observer: "observer", retriever: "retriever", retriever2: "retriever" };
  for (const [name, tok] of Object.entries(roles)) {
    const a = await call("POST", `/events/${eid}/applications`, tok, { message: "QA" });
    check(`${name} applies without a role`, a.status === 201, `status ${a.status}`);
  }
  const apps = await call("GET", `/events/${eid}/applications?status=pending`, admin);
  check("organizer sees 4 pending applications", apps.json?.items?.length === 4, `got ${apps.json?.items?.length}`);
  const noRole = await call("POST", `/events/${eid}/applications/${apps.json.items[0].id}/approve`, admin, {});
  check("approve without role is rejected", noRole.status === 400 || noRole.status === 422, `status ${noRole.status}`);
  for (const a of apps.json.items) {
    const key = Object.keys(grant).find((k) => a.user.email === who(k));
    const r = await call("POST", `/events/${eid}/applications/${a.id}/approve`, admin, { role: grant[key] });
    check(`approve ${key} as ${grant[key]}`, r.status === 200, `status ${r.status}`);
  }
  await call("PATCH", "/me/pilot", pilot, { phone: "+90 555 000 0000" });
  await call("PATCH", "/me/pilot", retriever, { phone: "+90 555 111 1111" });

  const obsWS = await wsClient(observer, [`event:${eid}`, `retrievals:${eid}`]);
  const retWS = await wsClient(retriever, [`retrievals:${eid}`]);
  const ret2WS = await wsClient(retriever2, [`retrievals:${eid}`]);

  // flight + telemetry
  const fid = crypto.randomUUID();
  const start = new Date(Date.now() - 60e3);
  const f = await call("POST", "/flights", pilot, { id: fid, event_id: eid, started_at: start.toISOString(), is_simulated: true, device: { platform: "ios", app_version: "qa" } });
  check("pilot starts flight", f.status === 201, `status ${f.status}`);
  const samples = Array.from({ length: 30 }, (_, i) => ({
    id: crypto.randomUUID(), seq: i, t: new Date(+start + i * 1000).toISOString(), device_t: new Date(+start + i * 1000).toISOString(),
    lat: 37.07 + i * 0.0002, lon: 29.34 + i * 0.0001, gps_alt_m: 2100 - i, h_acc_m: 5, v_acc_m: 4, speed_ms: 9, course_deg: 30,
  }));
  const batch = { batch_id: crypto.randomUUID(), flight_id: fid, samples };
  const b1 = await call("POST", "/telemetry/batches", pilot, batch);
  check("telemetry accepted", b1.status === 200 && b1.json.accepted.length === 30, `accepted ${b1.json?.accepted?.length}`);
  const b2 = await call("POST", "/telemetry/batches", pilot, { ...batch, batch_id: crypto.randomUUID() });
  check("re-sent samples reported as duplicate", b2.json?.duplicate?.length === 30 && b2.json?.accepted?.length === 0);
  const pos = await waitFor(obsWS.msgs, (m) => m.type === "position" && m.data?.flight_id === fid);
  check("observer receives live position over WebSocket", !!pos);

  const obsLive = await call("GET", `/events/${eid}/live`, observer);
  check("observer live snapshot shows the pilot", obsLive.json?.pilots?.some((p) => p.flight_id === fid));
  const retLive = await call("GET", `/events/${eid}/live`, retriever);
  check("retriever does not get the general live map", (retLive.json?.pilots || []).length === 0, `status ${retLive.status}`);
  const guest = await call("GET", `/events/${eid}/live`, null);
  check("guest sees no positions when public_live_map is off", guest.status !== 200 || (guest.json?.pilots || []).length === 0, `status ${guest.status}`);

  await call("POST", `/flights/${fid}/end`, pilot, { ended_at: new Date().toISOString() });
  const rid = crypto.randomUUID();
  const last = samples.at(-1);
  const rq = await call("POST", `/events/${eid}/retrievals`, pilot, { id: rid, flight_id: fid, pickup: { lat: last.lat, lon: last.lon, gps_alt_m: 800, h_acc_m: 6, t: new Date().toISOString() }, note: "QA yol kenarı", is_simulated: true });
  check("pilot requests retrieval", rq.status === 201, `status ${rq.status}`);
  const rqAgain = await call("POST", `/events/${eid}/retrievals`, pilot, { id: rid, flight_id: fid, pickup: { lat: last.lat, lon: last.lon, h_acc_m: 6, t: new Date().toISOString() } });
  check("retrieval creation is idempotent", rqAgain.status === 200, `status ${rqAgain.status}`);
  const seen = await waitFor(retWS.msgs, (m) => m.type === "retrieval" && m.data?.id === rid);
  check("retriever is notified of the request over WebSocket", !!seen);
  check("open request does not reveal the pilot phone", !seen?.data?.pilot?.phone);

  const [a1, a2] = await Promise.all([
    call("POST", `/retrievals/${rid}/accept`, retriever),
    call("POST", `/retrievals/${rid}/accept`, retriever2),
  ]);
  const winners = [a1, a2].filter((x) => x.status === 200).length;
  check("concurrent accept: exactly one winner, other gets 409", winners === 1 && [a1, a2].some((x) => x.status === 409), `${a1.status}/${a2.status}`);
  const winnerTok = a1.status === 200 ? retriever : retriever2;
  const loserTok = a1.status === 200 ? retriever2 : retriever;
  const won = a1.status === 200 ? a1 : a2;
  check("accepting retriever sees the pilot phone", !!won.json?.pilot?.phone);
  const loserView = await call("GET", `/retrievals/${rid}`, loserTok);
  check("other retriever no longer sees the accepted retrieval", loserView.status === 404 || loserView.status === 403, `status ${loserView.status}`);

  const pp = await call("POST", `/retrievals/${rid}/position`, pilot, { lat: last.lat + 0.001, lon: last.lon, h_acc_m: 8, t: new Date().toISOString() });
  check("pilot shares position while waiting", pp.status === 200, `status ${pp.status}`);
  const winnerWS = winnerTok === retriever ? retWS : ret2WS;
  const loserWS = winnerTok === retriever ? ret2WS : retWS;
  const pilotPos = await waitFor(winnerWS.msgs, (m) => m.type === "pilot_position" && m.data?.retrieval_id === rid);
  check("accepting retriever receives pilot_position", !!pilotPos);
  await new Promise((r) => setTimeout(r, 1500));
  check("other retriever does not receive pilot_position", !loserWS.msgs.some((m) => m.type === "pilot_position" && m.data?.retrieval_id === rid));

  const duty = await call("PUT", `/events/${eid}/retrievers/me/duty`, winnerTok, { on_duty: true });
  const rp = await call("POST", `/events/${eid}/retrievers/me/position`, winnerTok, { lat: 37.06, lon: 29.33, h_acc_m: 10, t: new Date().toISOString(), course_deg: 45, speed_ms: 12 });
  check("retriever shares position", [200, 204].includes(duty.status) && [200, 204].includes(rp.status), `${duty.status}/${rp.status}`);
  const obsRet = await waitFor(obsWS.msgs, (m) => m.type === "retriever_position");
  check("observer receives retriever_position", !!obsRet);

  const pu = await call("POST", `/retrievals/${rid}/picked-up`, winnerTok);
  const dv = await call("POST", `/retrievals/${rid}/delivered`, winnerTok, { note: "QA teslim" });
  check("picked up → delivered", pu.status === 200 && dv.status === 200 && dv.json?.status === "delivered", `${pu.status}/${dv.status}`);
  const bad = await call("POST", `/retrievals/${rid}/accept`, loserTok);
  check("invalid transition after delivery is refused", bad.status === 409 || bad.status === 404, `status ${bad.status}`);
  const obsDone = await waitFor(obsWS.msgs, (m) => m.type === "retrieval" && m.data?.id === rid && m.data?.status === "delivered");
  check("observer sees the delivery live", !!obsDone);

  const rep = await call("GET", `/events/${eid}/report`, admin);
  check("event report includes the retrieval", rep.status === 200 && JSON.stringify(rep.json).includes("retriev"), `status ${rep.status}`);

  for (const c of [obsWS, retWS, ret2WS]) c.ws.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

const mode = process.argv[2];
(mode === "register" ? register() : run()).catch((e) => { console.error("ERROR", e.message); process.exit(1); });
