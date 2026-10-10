use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: String,
    pub database_url: String,
    pub redis_url: String,
    /// İzin verilen web origin'leri (virgülle ayrılmış). Boşsa CORS kapalı (tek origin kurulum).
    pub cors_origins: Vec<String>,
    pub cookie_secure: bool,
    pub public_web_url: String,
    pub resend_api_key: Option<String>,
    pub mail_from: String,
    pub db_max_connections: u32,
    /// Yalnızca test ve yük testi için kapatılır.
    pub rate_limits: bool,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let var = |k: &str| env::var(k).ok().filter(|v| !v.is_empty());
        Ok(Self {
            bind: var("BIND").unwrap_or_else(|| "0.0.0.0:3001".into()),
            database_url: var("DATABASE_URL").ok_or_else(|| anyhow::anyhow!("DATABASE_URL is required"))?,
            redis_url: var("REDIS_URL").unwrap_or_else(|| "redis://127.0.0.1:6379".into()),
            cors_origins: var("CORS_ORIGINS")
                .map(|v| v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
                .unwrap_or_default(),
            cookie_secure: var("COOKIE_SECURE").map(|v| v != "false").unwrap_or(true),
            public_web_url: var("PUBLIC_WEB_URL").unwrap_or_else(|| "http://localhost:3000".into()),
            resend_api_key: var("RESEND_API_KEY"),
            mail_from: var("MAIL_FROM").unwrap_or_else(|| "Retfast <no-reply@retfast.com>".into()),
            db_max_connections: var("DB_MAX_CONNECTIONS").and_then(|v| v.parse().ok()).unwrap_or(20),
            rate_limits: var("RATE_LIMITS").map(|v| v != "off").unwrap_or(true),
        })
    }
}
