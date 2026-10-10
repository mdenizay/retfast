//! Etkinlik başına canlı yayın. Her şey Redis pub/sub üzerinden geçer; böylece birden çok
//! API örneği aynı etkinliğin WebSocket istemcilerine hizmet edebilir.
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use futures_util::StreamExt;
use redis::{AsyncCommands, aio::ConnectionManager};
use serde_json::Value;
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub enum Msg {
    /// Kullanıcının en güncel konumu. WS bağlantısı bunları kullanıcı bazında birleştirip saniyede bir yollar.
    Pos { user: Uuid, json: Arc<str> },
    /// Operasyon olayı (event_log satırı); hemen iletilir.
    Event(Arc<str>),
    /// Üyeliği biten kullanıcının bağlantılarını kapat.
    Kick(Uuid),
}

pub struct Hub {
    chans: Mutex<HashMap<Uuid, broadcast::Sender<Msg>>>,
    redis: ConnectionManager,
}

impl Hub {
    pub fn start(client: redis::Client, redis: ConnectionManager) -> Arc<Self> {
        let hub = Arc::new(Self { chans: Mutex::new(HashMap::new()), redis });
        let weak = Arc::downgrade(&hub);
        tokio::spawn(async move {
            loop {
                match client.get_async_pubsub().await {
                    Ok(mut pubsub) => {
                        if pubsub.psubscribe("rt:*").await.is_ok() {
                            let mut stream = pubsub.on_message();
                            while let Some(m) = stream.next().await {
                                let Some(hub) = weak.upgrade() else { return };
                                let (Some(event_id), Ok(payload)) = (
                                    m.get_channel_name().strip_prefix("rt:").and_then(|s| Uuid::parse_str(s).ok()),
                                    m.get_payload::<String>(),
                                ) else {
                                    continue;
                                };
                                hub.dispatch(event_id, &payload);
                            }
                        }
                        tracing::warn!("realtime: redis pubsub disconnected, reconnecting");
                    }
                    Err(e) => tracing::warn!(error = %e, "realtime: redis pubsub connect failed"),
                }
                if weak.strong_count() == 0 {
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
        });
        hub
    }

    fn dispatch(&self, event_id: Uuid, payload: &str) {
        let chans = self.chans.lock().unwrap();
        let Some(tx) = chans.get(&event_id) else { return };
        let (kind, rest) = payload.split_at(1);
        let msg = match kind {
            "E" => Msg::Event(rest.into()),
            "P" | "K" => {
                let Some((user, json)) = rest.split_once('|') else { return };
                let Ok(user) = Uuid::parse_str(user) else { return };
                if kind == "K" { Msg::Kick(user) } else { Msg::Pos { user, json: json.into() } }
            }
            _ => return,
        };
        let _ = tx.send(msg);
    }

    pub fn subscribe(&self, event_id: Uuid) -> broadcast::Receiver<Msg> {
        let mut chans = self.chans.lock().unwrap();
        chans.retain(|id, tx| *id == event_id || tx.receiver_count() > 0);
        chans.entry(event_id).or_insert_with(|| broadcast::channel(1024).0).subscribe()
    }

    pub fn connections(&self) -> usize {
        self.chans.lock().unwrap().values().map(|tx| tx.receiver_count()).sum()
    }

    async fn publish(&self, event_id: Uuid, payload: String) {
        let mut redis = self.redis.clone();
        if let Err(e) = redis.publish::<_, _, ()>(format!("rt:{event_id}"), payload).await {
            tracing::warn!(error = %e, "realtime: publish failed");
        }
    }

    pub async fn event(&self, event_id: Uuid, frame: &Value) {
        self.publish(event_id, format!("E{frame}")).await;
    }

    pub async fn pos(&self, event_id: Uuid, user: Uuid, json: &str) {
        self.publish(event_id, format!("P{user}|{json}")).await;
    }

    pub async fn kick(&self, event_id: Uuid, user: Uuid) {
        self.publish(event_id, format!("K{user}|")).await;
    }
}
