//! Operasyon olayları: önce `event_log`'a (işlemle birlikte), commit'ten sonra canlı yayına.
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::{error::AppResult, state::AppState};

pub struct Pending {
    event_id: Uuid,
    frame: Value,
}

pub async fn record(
    tx: &mut Transaction<'_, Postgres>,
    event_id: Uuid,
    kind: &str,
    actor: Option<Uuid>,
    subject: Option<Uuid>,
    payload: Value,
) -> AppResult<Pending> {
    let (seq, at): (i64, time::OffsetDateTime) = sqlx::query_as(
        "insert into event_log (event_id, type, actor_id, subject_id, payload)
         values ($1, $2, $3, $4, $5) returning seq, created_at",
    )
    .bind(event_id)
    .bind(kind)
    .bind(actor)
    .bind(subject)
    .bind(&payload)
    .fetch_one(&mut **tx)
    .await?;
    Ok(Pending {
        event_id,
        frame: json!({ "t": kind, "seq": seq, "at": at.unix_timestamp() * 1000 + at.millisecond() as i64,
                       "actor": actor, "subject": subject, "d": payload }),
    })
}

impl Pending {
    /// Yalnızca işlem commit edildikten sonra çağır.
    pub async fn publish(self, state: &AppState) {
        state.hub.event(self.event_id, &self.frame).await;
    }
}

pub async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    actor: Uuid,
    event_id: Option<Uuid>,
    action: &str,
    target: Option<(&str, Uuid)>,
    detail: Value,
) -> AppResult<()> {
    sqlx::query(
        "insert into audit_log (id, actor_id, event_id, action, target_type, target_id, detail)
         values ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(Uuid::now_v7())
    .bind(actor)
    .bind(event_id)
    .bind(action)
    .bind(target.map(|t| t.0))
    .bind(target.map(|t| t.1))
    .bind(detail)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn notify(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    event_id: Option<Uuid>,
    kind: &str,
    critical: bool,
    payload: Value,
) -> AppResult<()> {
    sqlx::query("insert into notifications (id, user_id, event_id, kind, critical, payload) values ($1, $2, $3, $4, $5, $6)")
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(event_id)
        .bind(kind)
        .bind(critical)
        .bind(payload)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
