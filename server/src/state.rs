use std::sync::Arc;

use redis::aio::ConnectionManager;
use sqlx::PgPool;

use crate::{config::Config, realtime::Hub};

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: ConnectionManager,
    pub hub: Arc<Hub>,
    pub config: Arc<Config>,
    pub http: reqwest::Client,
}

impl AppState {
    pub async fn connect(config: Config) -> anyhow::Result<Self> {
        let db = sqlx::postgres::PgPoolOptions::new()
            .max_connections(config.db_max_connections)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .connect(&config.database_url)
            .await?;
        let client = redis::Client::open(config.redis_url.as_str())?;
        let redis = ConnectionManager::new(client.clone()).await?;
        let hub = Hub::start(client, redis.clone());
        Ok(Self { db, redis, hub, config: Arc::new(config), http: reqwest::Client::new() })
    }
}
