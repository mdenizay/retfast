//! Uçtan uca testler: gerçek PostgreSQL + Redis, süreç içi sunucu, gerçek HTTP ve WebSocket.
use std::{net::SocketAddr, time::Duration};

use futures_util::StreamExt;
use reqwest::{Client, StatusCode};
use retfast_server::{MIGRATOR, config::Config, routes, state::AppState};
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest};

struct Srv {
    base: String,
    addr: SocketAddr,
    db: PgPool,
    http: Client,
}

async fn spawn() -> Srv {
    let admin_url = std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| "postgres://retfast:retfast@localhost/postgres".into());
    let name = format!("retfast_test_{}", uuid::Uuid::new_v4().simple());
    let admin = PgPool::connect(&admin_url).await.expect("test postgres");
    sqlx::query(sqlx::AssertSqlSafe(format!("create database {name}"))).execute(&admin).await.unwrap();
    let database_url = format!("{}/{name}", admin_url.rsplit_once('/').unwrap().0);
    let config = Config {
        bind: "127.0.0.1:0".into(),
        database_url,
        redis_url: std::env::var("TEST_REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
        cors_origins: vec![],
        cookie_secure: false,
        public_web_url: "http://localhost".into(),
        resend_api_key: None,
        mail_from: "test@example.com".into(),
        db_max_connections: 5,
        rate_limits: false,
    };
    let state = AppState::connect(config).await.unwrap();
    MIGRATOR.run(&state.db).await.unwrap();
    let db = state.db.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, routes::app(state).into_make_service_with_connect_info::<SocketAddr>()).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(150)).await; // redis pubsub aboneliği kurulsun
    Srv { base: format!("http://{addr}/v1"), addr, db, http: Client::new() }
}

struct User {
    id: String,
    token: String,
}

impl Srv {
    async fn call(&self, method: &str, path: &str, token: Option<&str>, body: Value) -> (StatusCode, Value) {
        let mut req = self.http.request(method.parse().unwrap(), format!("{}{path}", self.base));
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        if !body.is_null() {
            req = req.json(&body);
        }
        let res = req.send().await.unwrap();
        let status = res.status();
        (status, res.json().await.unwrap_or(Value::Null))
    }

    async fn ok(&self, method: &str, path: &str, user: &User, body: Value) -> Value {
        let (status, v) = self.call(method, path, Some(&user.token), body).await;
        assert!(status.is_success(), "{method} {path} -> {status}: {v}");
        v
    }

    async fn err(&self, method: &str, path: &str, user: &User, body: Value) -> (StatusCode, String) {
        let (status, v) = self.call(method, path, Some(&user.token), body).await;
        assert!(!status.is_success(), "{method} {path} unexpectedly succeeded: {v}");
        (status, v["error"]["code"].as_str().unwrap_or("").to_string())
    }

    async fn user(&self, name: &str) -> User {
        let (status, v) = self
            .call(
                "POST",
                "/auth/register",
                None,
                json!({
                    "email": format!("{name}@example.com"), "password": "correct horse", "first_name": name, "last_name": "Test"
                }),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{v}");
        let user = User { id: v["user"]["id"].as_str().unwrap().into(), token: v["token"].as_str().unwrap().into() };
        self.ok("POST", "/me/consent/location", &user, Value::Null).await;
        user
    }

    async fn sysadmin(&self) -> User {
        let u = self.user("root").await;
        sqlx::query("update users set is_system_admin = true where email = 'root@example.com'").execute(&self.db).await.unwrap();
        // Yetki oturum önbelleğinde 60 sn tutulur; yeniden giriş yeni oturumla güncel yetkiyi alır.
        let (_, v) = self.call("POST", "/auth/login", None, json!({ "email": "root@example.com", "password": "correct horse" })).await;
        User { id: u.id, token: v["token"].as_str().unwrap().into() }
    }

    async fn event(&self, admin: &User, name: &str, status: &str) -> String {
        let v = self
            .ok(
                "POST",
                "/events",
                admin,
                json!({
                    "name": name, "starts_at": "2026-10-01T06:00:00Z", "ends_at": "2026-12-01T18:00:00Z",
                    "city": "Çameli", "country": "TR", "center_lat": 37.07, "center_lon": 29.34, "status": status
                }),
            )
            .await;
        v["id"].as_str().unwrap().into()
    }

    /// Başvur + kabul: gerçek akışla üye yapar.
    async fn join(&self, admin: &User, event: &str, user: &User, role: &str) {
        let a = self.ok("POST", &format!("/events/{event}/applications"), user, json!({ "requested_role": role })).await;
        self.ok(
            "POST",
            &format!("/applications/{}/decide", a["id"].as_str().unwrap()),
            admin,
            json!({ "decision": "accept", "role": role }),
        )
        .await;
    }

    async fn ws(&self, event: &str, user: &User) -> Ws {
        let mut req = format!("ws://{}/v1/events/{event}/ws", self.addr).into_client_request().unwrap();
        req.headers_mut().insert("authorization", format!("Bearer {}", user.token).parse().unwrap());
        let (stream, _) = tokio_tungstenite::connect_async(req).await.expect("ws connect");
        let mut ws = Ws(stream);
        assert_eq!(ws.next().await["t"], "hello");
        ws
    }
}

struct Ws(tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>);

impl Ws {
    async fn next(&mut self) -> Value {
        loop {
            let msg = tokio::time::timeout(Duration::from_secs(5), self.0.next()).await.expect("ws frame timeout").unwrap().unwrap();
            if let Message::Text(t) = msg {
                return serde_json::from_str(&t).unwrap();
            }
        }
    }

    async fn until(&mut self, kind: &str) -> Value {
        loop {
            let v = self.next().await;
            if v["t"] == kind {
                return v;
            }
        }
    }
}

fn now_ms() -> i64 {
    (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

/// Ürünün ilk sürümde eksiksiz olması gereken akış.
#[tokio::test]
async fn full_event_flow() {
    let s = spawn().await;
    let root = s.sysadmin().await;
    let (admin, pilot, retriever, observer) =
        (s.user("admin").await, s.user("pilot").await, s.user("retriever").await, s.user("observer").await);

    // Sistem admini etkinlik oluşturur ve etkinlik admini atar.
    let ev = s.event(&root, "Çameli XC-Open 2026", "published").await;
    let (status, _) = s
        .err("POST", "/events", &admin, json!({ "name": "x", "starts_at": "2026-10-01T06:00:00Z", "ends_at": "2026-10-02T06:00:00Z" }))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    s.ok("PUT", &format!("/events/{ev}/members/{}", admin.id), &root, json!({ "role": "event_admin" })).await;

    // Herkese açık listede görünür; slug Türkçe karakterlerden arınır.
    let (_, list) = s.call("GET", "/events?scope=current", None, Value::Null).await;
    assert_eq!(list["data"][0]["slug"], "cameli-xc-open-2026");

    // Başvuru → etkinlik admini rol vererek kabul eder.
    s.join(&admin, &ev, &pilot, "pilot").await;
    s.join(&admin, &ev, &retriever, "retriever").await;
    s.join(&admin, &ev, &observer, "observer").await;
    let mine = s.ok("GET", "/me/events", &pilot, Value::Null).await;
    assert_eq!(mine["memberships"][0]["role"], "pilot");
    let notes = s.ok("GET", "/me/notifications", &pilot, Value::Null).await;
    assert_eq!(notes["data"][0]["kind"], "application.decided");

    // Etkinlik aktif değilken takip başlatılamaz.
    assert_eq!(s.err("POST", &format!("/events/{ev}/tracking/start"), &pilot, Value::Null).await.1, "EVENT_NOT_ACTIVE");
    s.ok("PATCH", &format!("/events/{ev}"), &admin, json!({ "status": "active" })).await;

    // Observer canlı kanala bağlanır.
    let mut ws = s.ws(&ev, &observer).await;

    // Pilot ve retriever konum paylaşır.
    let ps = s.ok("POST", &format!("/events/{ev}/tracking/start"), &pilot, json!({ "platform": "ios" })).await;
    // Gövdesiz ama Content-Type'lı istek (fetch/URLSession böyle yollar) reddedilmemeli.
    let bare = s
        .http
        .post(format!("{}/events/{ev}/tracking/stop", s.base))
        .bearer_auth(&retriever.token)
        .header("content-type", "application/json")
        .send()
        .await
        .unwrap();
    assert_eq!(bare.status(), StatusCode::OK);
    let bare = s
        .http
        .post(format!("{}/events/{ev}/flights/takeoff", s.base))
        .bearer_auth(&retriever.token)
        .header("content-type", "application/json")
        .send()
        .await
        .unwrap();
    assert_eq!(bare.status(), StatusCode::FORBIDDEN, "empty body parses; role check still applies");
    assert_eq!(ps["config"]["moving"]["interval_s"], 5);
    let rs = s.ok("POST", &format!("/events/{ev}/tracking/start"), &retriever, Value::Null).await;
    let t = now_ms();
    let batch = json!({ "session_id": ps["session_id"], "points": [
        { "t": t - 10_000, "lat": 37.10, "lon": 29.30, "alt": 1800.0, "spd": 9.5, "acc": 5.0, "bat": 80 },
        { "t": t - 5_000, "lat": 37.11, "lon": 29.31, "alt": 1750.0, "spd": 10.0, "acc": 5.0, "bat": 80 },
        { "t": t, "lat": 37.12, "lon": 29.32, "alt": 1700.0, "spd": 10.5, "acc": 4.0, "bat": 79 },
        { "t": t, "lat": 999.0, "lon": 29.32 }
    ]});
    let r = s.ok("POST", &format!("/events/{ev}/tracking/points"), &pilot, batch.clone()).await;
    assert_eq!((r["accepted"].as_i64(), r["stored"].as_i64()), (Some(3), Some(3)), "invalid point dropped");
    s.ok(
        "POST",
        &format!("/events/{ev}/tracking/points"),
        &retriever,
        json!({ "session_id": rs["session_id"],
        "points": [{ "t": t, "lat": 37.00, "lon": 29.20, "spd": 0.0 }] }),
    )
    .await;

    // Observer her kullanıcının yalnızca son konumunu, birleştirilmiş tek çerçevede alır.
    let frame = ws.until("positions").await;
    let pos = frame["d"].as_array().unwrap().iter().find(|p| p["u"] == pilot.id.as_str()).expect("pilot position").clone();
    assert_eq!(pos["lat"], 37.12);

    // Bağlantı kopup aynı parti yeniden gönderilirse kayıt çoğalmaz.
    let r = s.ok("POST", &format!("/events/{ev}/tracking/points"), &pilot, batch).await;
    assert_eq!(r["stored"], 0);
    // Gecikmiş eski nokta saklanır ama güncel konumu geri almaz.
    s.ok(
        "POST",
        &format!("/events/{ev}/tracking/points"),
        &pilot,
        json!({ "session_id": ps["session_id"],
        "points": [{ "t": t - 60_000, "lat": 37.0, "lon": 29.0 }] }),
    )
    .await;
    let track = s.ok("GET", &format!("/events/{ev}/tracks/{}", pilot.id), &observer, Value::Null).await;
    let points = track["points"].as_array().unwrap();
    assert_eq!(points.len(), 4);
    assert!(points.windows(2).all(|w| w[0][0].as_i64() < w[1][0].as_i64()), "track is ordered by fix time");

    // Uçuş ve retrieve akışı; her adım observer'a canlı gider.
    s.ok("POST", &format!("/events/{ev}/flights/takeoff"), &pilot, Value::Null).await;
    assert_eq!(ws.until("flight.takeoff").await["subject"], pilot.id.as_str());
    let req = s.ok("POST", &format!("/events/{ev}/retrieves"), &pilot, json!({ "lat": 37.12, "lon": 29.32, "note": "yol kenarı" })).await;
    let rid = req["id"].as_str().unwrap();
    assert_eq!(ws.until("flight.landed").await["subject"], pilot.id.as_str()); // talep inişi de kaydeder
    let requested = ws.until("retrieve.requested").await;
    assert!(requested["seq"].as_i64().unwrap() > 0);
    assert_eq!(s.err("POST", &format!("/events/{ev}/retrieves"), &pilot, json!({ "lat": 37.1, "lon": 29.3 })).await.1, "RETRIEVE_EXISTS");

    let live = s.ok("GET", &format!("/events/{ev}/live"), &observer, Value::Null).await;
    let state_of =
        |live: &Value, id: &str| live["members"].as_array().unwrap().iter().find(|m| m["user_id"] == id).unwrap()["pilot_state"].clone();
    assert_eq!(state_of(&live, &pilot.id), "awaiting_retrieve");
    assert_eq!(live["positions"].as_array().unwrap().len(), 2);
    assert_eq!(live["positions"].as_array().unwrap().iter().find(|p| p["u"] == pilot.id.as_str()).unwrap()["lat"], 37.12);

    // Pilot başkasının talebini yönetemez; retriever kabul eder ve teslim alır.
    assert_eq!(s.err("POST", &format!("/retrieves/{rid}/accept"), &pilot, Value::Null).await.0, StatusCode::FORBIDDEN);
    s.ok("POST", &format!("/retrieves/{rid}/accept"), &retriever, Value::Null).await;
    assert_eq!(ws.until("retrieve.assigned").await["d"]["retriever_id"], retriever.id.as_str());
    assert_eq!(s.err("POST", &format!("/retrieves/{rid}/complete"), &retriever, Value::Null).await.1, "RETRIEVE_STATE_CHANGED");
    s.ok("POST", &format!("/retrieves/{rid}/arrived"), &retriever, Value::Null).await;
    s.ok("POST", &format!("/retrieves/{rid}/picked-up"), &retriever, Value::Null).await;
    let live = s.ok("GET", &format!("/events/{ev}/live"), &pilot, Value::Null).await;
    assert_eq!(state_of(&live, &pilot.id), "picked_up");
    // Araçtayken etkinlikten ayrılınamaz.
    assert_eq!(s.err("POST", &format!("/events/{ev}/leave"), &pilot, Value::Null).await.1, "ACTIVE_OPERATION");
    s.ok("POST", &format!("/retrieves/{rid}/complete"), &retriever, Value::Null).await;
    ws.until("retrieve.completed").await;
    let live = s.ok("GET", &format!("/events/{ev}/live"), &observer, Value::Null).await;
    assert_eq!(state_of(&live, &pilot.id), "completed");
    assert!(live["retrieves"].as_array().unwrap().is_empty());

    // Zaman çizelgesi sıralı ve eksiksiz; yeniden bağlanan istemci kaçırdığını buradan alır.
    let log = s.ok("GET", &format!("/events/{ev}/log?after={}", requested["seq"]), &observer, Value::Null).await;
    let kinds: Vec<&str> = log["data"].as_array().unwrap().iter().map(|e| e["t"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["retrieve.assigned", "retrieve.arrived", "retrieve.picked_up", "flight.completed", "retrieve.completed"]);

    // Etkinlik bitince konum paylaşımı sunucu tarafında kapanır.
    s.ok("PATCH", &format!("/events/{ev}"), &admin, json!({ "status": "completed" })).await;
    let (_, code) = s
        .err(
            "POST",
            &format!("/events/{ev}/tracking/points"),
            &pilot,
            json!({ "session_id": ps["session_id"],
        "points": [{ "t": now_ms(), "lat": 37.0, "lon": 29.0 }] }),
        )
        .await;
    assert_eq!(code, "TRACKING_SESSION_CLOSED");
}

/// Aynı talebi iki retriever aynı anda kabul ederse yalnızca biri kazanır.
#[tokio::test]
async fn concurrent_accept_has_one_winner() {
    let s = spawn().await;
    let root = s.sysadmin().await;
    let ev = s.event(&root, "Race", "active").await;
    let (pilot, r1, r2) = (s.user("p").await, s.user("r1").await, s.user("r2").await);
    s.join(&root, &ev, &pilot, "pilot").await;
    s.join(&root, &ev, &r1, "retriever").await;
    s.join(&root, &ev, &r2, "retriever").await;
    let req = s.ok("POST", &format!("/events/{ev}/retrieves"), &pilot, json!({ "lat": 37.0, "lon": 29.0 })).await;
    let path = format!("/retrieves/{}/accept", req["id"].as_str().unwrap());
    let (a, b) = tokio::join!(s.call("POST", &path, Some(&r1.token), Value::Null), s.call("POST", &path, Some(&r2.token), Value::Null));
    let wins = [&a, &b].iter().filter(|r| r.0.is_success()).count();
    assert_eq!(wins, 1, "{a:?} {b:?}");
    let loser = if a.0.is_success() { b } else { a };
    assert_eq!((loser.0, loser.1["error"]["code"].as_str()), (StatusCode::CONFLICT, Some("RETRIEVE_STATE_CHANGED")));

    // Pilot başka retriever isteyebilir; talep yeniden açılır ve yetkili elle atayabilir.
    s.ok("POST", &format!("/retrieves/{}/release", req["id"].as_str().unwrap()), &pilot, Value::Null).await;
    let v = s.ok("POST", &format!("/retrieves/{}/assign", req["id"].as_str().unwrap()), &root, json!({ "retriever_id": r2.id })).await;
    assert_eq!(v["retriever_id"], r2.id.as_str());
    let audited: i64 =
        sqlx::query_scalar("select count(*) from audit_log where action = 'retrieve.assigned'").fetch_one(&s.db).await.unwrap();
    assert_eq!(audited, 1, "manual dispatch is audited");
}

/// Bir etkinliğin verisi başka etkinliğin kullanıcısına sızmaz; roller etkinlik bazlıdır.
#[tokio::test]
async fn events_are_isolated_and_roles_are_scoped() {
    let s = spawn().await;
    let root = s.sysadmin().await;
    let (a, b) = (s.event(&root, "A", "active").await, s.event(&root, "B", "active").await);
    let (alice, bob) = (s.user("alice").await, s.user("bob").await);
    s.join(&root, &a, &alice, "pilot").await;
    s.join(&root, &b, &alice, "observer").await; // aynı hesap, farklı etkinlikte farklı rol
    s.join(&root, &b, &bob, "pilot").await;

    for path in [
        format!("/events/{a}/live"),
        format!("/events/{a}/members"),
        format!("/events/{a}/log"),
        format!("/events/{a}/tracks/{}", alice.id),
    ] {
        assert_eq!(s.err("GET", &path, &bob, Value::Null).await.0, StatusCode::FORBIDDEN, "{path}");
    }
    let mut req = format!("ws://{}/v1/events/{a}/ws", s.addr).into_client_request().unwrap();
    req.headers_mut().insert("authorization", format!("Bearer {}", bob.token).parse().unwrap());
    assert!(tokio_tungstenite::connect_async(req).await.is_err(), "non-member cannot open the live channel");

    // Alice B'de observer: Bob adına iniş işaretleyebilir (denetlenir); A'da pilot olduğu için orada yapamaz.
    s.ok("POST", &format!("/events/{b}/flights/land"), &alice, json!({ "pilot_id": bob.id, "lat": 37.0, "lon": 29.0 })).await;
    let audited: i64 = sqlx::query_scalar("select count(*) from audit_log where action = 'flight.landed'").fetch_one(&s.db).await.unwrap();
    assert_eq!(audited, 1);
    assert_eq!(s.err("POST", &format!("/events/{a}/flights/land"), &alice, json!({ "pilot_id": bob.id })).await.0, StatusCode::FORBIDDEN);
    // Pilot diğer pilotların telefonunu görmez, observer görür.
    let as_pilot = s.ok("GET", &format!("/events/{b}/members"), &bob, Value::Null).await;
    assert!(as_pilot["data"][0].get("phone").is_none());
    let as_observer = s.ok("GET", &format!("/events/{b}/members"), &alice, Value::Null).await;
    assert!(as_observer["data"][0].get("phone").is_some());

    // Özel etkinlik: davet kodu olmadan yok hükmünde, kodla başvurulabilir.
    let private = s
        .ok(
            "POST",
            "/events",
            &root,
            json!({ "name": "Private", "visibility": "private", "status": "published",
        "starts_at": "2026-10-01T06:00:00Z", "ends_at": "2026-12-01T18:00:00Z" }),
        )
        .await;
    let pid = private["id"].as_str().unwrap();
    assert_eq!(s.call("GET", &format!("/events/{pid}"), None, Value::Null).await.0, StatusCode::NOT_FOUND);
    assert_eq!(s.err("POST", &format!("/events/{pid}/applications"), &bob, json!({})).await.0, StatusCode::NOT_FOUND);
    s.ok("POST", &format!("/events/{pid}/applications"), &bob, json!({ "invite_code": private["invite_code"] })).await;
    assert_eq!(
        s.err("POST", &format!("/events/{pid}/applications"), &bob, json!({ "invite_code": private["invite_code"] })).await.1,
        "ALREADY_APPLIED"
    );

    // Etkinlik admini atamak sistem adminine özgü; üyelikten çıkarılan kullanıcı erişimi kaybeder.
    s.ok("PUT", &format!("/events/{b}/members/{}", alice.id), &root, json!({ "role": "event_admin" })).await;
    assert_eq!(
        s.err("PUT", &format!("/events/{b}/members/{}", bob.id), &alice, json!({ "role": "event_admin" })).await.0,
        StatusCode::FORBIDDEN
    );
    s.ok("DELETE", &format!("/events/{b}/members/{}", bob.id), &alice, Value::Null).await;
    assert_eq!(s.err("GET", &format!("/events/{b}/live"), &bob, Value::Null).await.0, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn auth_and_sos() {
    let s = spawn().await;
    let root = s.sysadmin().await;
    let ev = s.event(&root, "Sos", "active").await;
    let pilot = s.user("pilot").await;
    s.join(&root, &ev, &pilot, "pilot").await;

    assert_eq!(s.call("GET", "/me", None, Value::Null).await.0, StatusCode::UNAUTHORIZED);
    let (status, v) = s.call("POST", "/auth/login", None, json!({ "email": "pilot@example.com", "password": "wrong" })).await;
    assert_eq!((status, v["error"]["code"].as_str()), (StatusCode::CONFLICT, Some("INVALID_CREDENTIALS")));
    let (_, v) = s
        .call(
            "POST",
            "/auth/register",
            None,
            json!({ "email": "PILOT@example.com", "password": "correct horse", "first_name": "a", "last_name": "b" }),
        )
        .await;
    assert_eq!(v["error"]["code"], "EMAIL_TAKEN");
    let stored: String =
        sqlx::query_scalar("select password_hash from users where email = 'pilot@example.com'").fetch_one(&s.db).await.unwrap();
    assert!(stored.starts_with("$argon2id$"));

    // SOS: tekrar gönderim yeni kayıt açmaz; yetkili onaylar ve kapatır.
    let mut ws = s.ws(&ev, &root).await;
    let a = s.ok("POST", &format!("/events/{ev}/sos"), &pilot, json!({ "lat": 37.0, "lon": 29.0 })).await;
    let b = s.ok("POST", &format!("/events/{ev}/sos"), &pilot, json!({ "lat": 37.1, "lon": 29.1 })).await;
    assert_eq!(a["id"], b["id"]);
    assert_eq!(ws.until("sos.raised").await["d"]["id"], a["id"]);
    let sid = a["id"].as_str().unwrap();
    assert_eq!(s.err("POST", &format!("/sos/{sid}/ack"), &pilot, Value::Null).await.0, StatusCode::FORBIDDEN);
    s.ok("POST", &format!("/sos/{sid}/ack"), &root, Value::Null).await;
    s.ok("POST", &format!("/sos/{sid}/resolve"), &root, json!({ "note": "false alarm" })).await;
    let live = s.ok("GET", &format!("/events/{ev}/live"), &root, Value::Null).await;
    assert!(live["sos"].as_array().unwrap().is_empty());

    // Şifre değişimi: eski şifre doğrulanır, diğer oturumlar kapanır, bu oturum devam eder.
    let (_, other) = s.call("POST", "/auth/login", None, json!({ "email": "pilot@example.com", "password": "correct horse" })).await;
    let other = other["token"].as_str().unwrap().to_string();
    assert_eq!(
        s.err("POST", "/me/password", &pilot, json!({ "current_password": "nope", "new_password": "new password 1" })).await.1,
        "INVALID_CREDENTIALS"
    );
    s.ok("POST", "/me/password", &pilot, json!({ "current_password": "correct horse", "new_password": "new password 1" })).await;
    assert_eq!(s.call("GET", "/me", Some(&other), Value::Null).await.0, StatusCode::UNAUTHORIZED);
    let (status, _) = s.call("POST", "/auth/login", None, json!({ "email": "pilot@example.com", "password": "new password 1" })).await;
    assert_eq!(status, StatusCode::OK);

    // Çıkış yapan oturum hemen geçersizleşir.
    s.ok("POST", "/auth/logout", &pilot, Value::Null).await;
    assert_eq!(s.call("GET", "/me", Some(&pilot.token), Value::Null).await.0, StatusCode::UNAUTHORIZED);
}

/// Çevrimdışı kalan kuyruk, kullanıcı takibi durdurduktan sonra da yüklenebilmeli; admin/etkinlik kapanışından sonra değil.
#[tokio::test]
async fn late_points_after_user_stop_are_accepted() {
    let s = spawn().await;
    let root = s.sysadmin().await;
    let ev = s.event(&root, "Late", "active").await;
    let pilot = s.user("late").await;
    s.join(&root, &ev, &pilot, "pilot").await;
    let session = s.ok("POST", &format!("/events/{ev}/tracking/start"), &pilot, Value::Null).await;
    s.ok("POST", &format!("/events/{ev}/tracking/stop"), &pilot, Value::Null).await;
    let body = json!({ "session_id": session["session_id"], "points": [{ "t": now_ms() - 30_000, "lat": 37.0, "lon": 29.0 }] });
    let r = s.ok("POST", &format!("/events/{ev}/tracking/points"), &pilot, body.clone()).await;
    assert_eq!(r["stored"], 1, "tail of a user-closed session is stored");

    // Etkinlik admini oturumu kapatırsa (üyelikten çıkarma) kuyruk artık kabul edilmez.
    s.ok("DELETE", &format!("/events/{ev}/members/{}", pilot.id), &root, Value::Null).await;
    let (status, code) = s.err("POST", &format!("/events/{ev}/tracking/points"), &pilot, body).await;
    assert_eq!((status, code.as_str()), (StatusCode::CONFLICT, "TRACKING_SESSION_CLOSED"), "removed members cannot push points");
}

#[tokio::test]
async fn announcements_report_export_and_suggestions() {
    let s = spawn().await;
    let root = s.sysadmin().await;
    let ev = s.event(&root, "Outreach", "active").await;
    let (pilot, outsider) = (s.user("pilot").await, s.user("outsider").await);
    s.join(&root, &ev, &pilot, "pilot").await;

    // Duyuru: yalnızca admin yayınlar; üyeler bildirim ve canlı olay alır; üye olmayan göremez.
    let mut ws = s.ws(&ev, &pilot).await;
    assert_eq!(s.err("POST", &format!("/events/{ev}/announcements"), &pilot, json!({ "title": "x" })).await.0, StatusCode::FORBIDDEN);
    s.ok("POST", &format!("/events/{ev}/announcements"), &root, json!({ "title": "Briefing 08:00", "body": "Meeting point: square" }))
        .await;
    assert_eq!(ws.until("announcement.posted").await["d"]["title"], "Briefing 08:00");
    let notes = s.ok("GET", "/me/notifications", &pilot, Value::Null).await;
    assert_eq!(notes["data"][0]["kind"], "announcement");
    let list = s.ok("GET", &format!("/events/{ev}/announcements"), &pilot, Value::Null).await;
    assert_eq!(list["data"][0]["body"], "Meeting point: square");
    assert_eq!(s.err("GET", &format!("/events/{ev}/announcements"), &outsider, Value::Null).await.0, StatusCode::FORBIDDEN);

    // Davet: admin gönderir; tekrarlar ve geçersiz adresler ayıklanır.
    let r = s.ok("POST", &format!("/events/{ev}/invites"), &root, json!({ "emails": ["a@example.com", "A@example.com", "broken"] })).await;
    assert_eq!((r["sent"].as_i64(), r["skipped"][0].as_str()), (Some(1), Some("broken")));
    assert_eq!(
        s.err("POST", &format!("/events/{ev}/invites"), &pilot, json!({ "emails": ["b@example.com"] })).await.0,
        StatusCode::FORBIDDEN
    );

    // Konum: hızlı hareket, uçuş yokken kalkış önerisi üretir; durum kendiliğinden değişmez.
    let session = s.ok("POST", &format!("/events/{ev}/tracking/start"), &pilot, Value::Null).await;
    let t = now_ms();
    let points: Vec<Value> = (0..6)
        .map(|i| json!({ "t": t - 30_000 + i * 6_000, "lat": 37.0 + i as f64 * 0.001, "lon": 29.0, "alt": 1500.0 + i as f64, "spd": 9.0 }))
        .collect();
    s.ok("POST", &format!("/events/{ev}/tracking/points"), &pilot, json!({ "session_id": session["session_id"], "points": points })).await;
    let sug = ws.until("flight.suggestion").await;
    assert_eq!((sug["subject"].as_str(), sug["d"]["kind"].as_str()), (Some(pilot.id.as_str()), Some("takeoff")));
    let live = s.ok("GET", &format!("/events/{ev}/live"), &root, Value::Null).await;
    let state = live["members"].as_array().unwrap().iter().find(|m| m["user_id"] == pilot.id.as_str()).unwrap()["pilot_state"].clone();
    assert_eq!(state, "preparing", "a suggestion never changes state by itself");

    // Dışa aktarma: GPX ve IGC; başkasının izini yalnızca yetkili indirebilir.
    let gpx =
        s.http.get(format!("{}/events/{ev}/tracks/{}/export?format=gpx", s.base, pilot.id)).bearer_auth(&pilot.token).send().await.unwrap();
    assert_eq!(gpx.status(), StatusCode::OK);
    assert!(gpx.headers()["content-disposition"].to_str().unwrap().contains(".gpx"));
    let body = gpx.text().await.unwrap();
    assert_eq!(body.matches("<trkpt").count(), 6);
    let igc = s
        .http
        .get(format!("{}/events/{ev}/tracks/{}/export?format=igc", s.base, pilot.id))
        .bearer_auth(&root.token)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(igc.lines().filter(|l| l.starts_with('B')).count(), 6);
    assert_eq!(s.err("GET", &format!("/events/{ev}/tracks/{}/export", root.id), &pilot, Value::Null).await.0, StatusCode::FORBIDDEN);

    // Rapor: yalnızca yetkililer.
    s.ok("POST", &format!("/events/{ev}/flights/takeoff"), &pilot, Value::Null).await;
    let report = s.ok("GET", &format!("/events/{ev}/report"), &root, Value::Null).await;
    assert_eq!(report["members"]["pilot"], 1);
    assert_eq!(report["flights"]["total"], 1);
    assert_eq!(report["tracking"]["points"], 6);
    assert_eq!(s.err("GET", &format!("/events/{ev}/report"), &pilot, Value::Null).await.0, StatusCode::FORBIDDEN);
}
