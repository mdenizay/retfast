//! Etkinlik canlı kanalı. Kimlik el sıkışmada doğrulanır (web: cookie, mobil: Authorization başlığı).
//! Sunucu → istemci çerçeveleri:
//!   {"t":"hello","last_seq":N}             bağlanınca; istemci `GET /events/{id}/live` ile durumu çeker
//!   {"t":"positions","d":[{u,t,lat,lon…}]}  saniyede en çok bir kez, kullanıcı başına yalnızca son konum
//!   {"t":"<olay>","seq":N,"at":ms,…}        operasyon olayı
//!   {"t":"resync"}                          istemci geride kaldı; durumu yeniden çekmeli
use std::{collections::HashMap, sync::Arc, time::Duration};

use axum::{
    Router,
    extract::{
        Path, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
    routing::get,
};
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

use crate::{auth::AuthUser, authz::Access, error::AppResult, realtime::Msg, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new().route("/events/{id}/ws", get(upgrade))
}

async fn upgrade(State(state): State<AppState>, user: AuthUser, Path(event_id): Path<Uuid>, ws: WebSocketUpgrade) -> AppResult<Response> {
    Access::load(&state.db, user, event_id).await?.member()?;
    Ok(ws.max_message_size(4096).on_upgrade(move |socket| run(state, socket, event_id, user.id)))
}

async fn run(state: AppState, mut socket: WebSocket, event_id: Uuid, user_id: Uuid) {
    // Önce abone ol, sonra last_seq oku: arada olay kaçmaz (fazladan gelen seq istemcide elenir).
    let mut rx = state.hub.subscribe(event_id);
    let last_seq: i64 = sqlx::query_scalar("select coalesce(max(seq), 0) from event_log where event_id = $1")
        .bind(event_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);
    if socket.send(Message::Text(format!(r#"{{"t":"hello","last_seq":{last_seq}}}"#).into())).await.is_err() {
        return;
    }
    let mut pending: HashMap<Uuid, Arc<str>> = HashMap::new();
    let mut flush = tokio::time::interval(Duration::from_secs(1));
    // Cloudflare boşta kalan WS'i ~100 sn'de keser; ping bağlantıyı açık tutar ve ölü istemciyi ortaya çıkarır.
    let mut ping = tokio::time::interval(Duration::from_secs(25));
    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Ok(Msg::Pos { user, json }) => { pending.insert(user, json); }
                Ok(Msg::Event(json)) => {
                    if socket.send(Message::Text(json.as_ref().into())).await.is_err() { break }
                }
                Ok(Msg::Kick(user)) if user == user_id => break,
                Ok(Msg::Kick(_)) => {}
                Err(RecvError::Lagged(_)) => {
                    pending.clear();
                    if socket.send(Message::Text(r#"{"t":"resync"}"#.into())).await.is_err() { break }
                }
                Err(RecvError::Closed) => break,
            },
            _ = flush.tick() => {
                if pending.is_empty() { continue }
                let mut frame = String::with_capacity(32 + pending.len() * 160);
                frame.push_str(r#"{"t":"positions","d":["#);
                for (i, json) in pending.drain().map(|(_, j)| j).enumerate() {
                    if i > 0 { frame.push(',') }
                    frame.push_str(&json);
                }
                frame.push_str("]}");
                if socket.send(Message::Text(frame.into())).await.is_err() { break }
            }
            _ = ping.tick() => {
                if socket.send(Message::Ping(Default::default())).await.is_err() { break }
            }
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {} // istemciden komut alınmaz; yazma işlemleri HTTP API'den
            },
        }
    }
}
