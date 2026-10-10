use std::net::SocketAddr;

use retfast_server::{MIGRATOR, config::Config, routes, state::AppState};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,tower_http=info,sqlx=warn".into());
    if std::env::var("LOG_FORMAT").as_deref() == Ok("json") {
        tracing_subscriber::fmt().json().with_env_filter(filter).init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }

    let config = Config::from_env()?;
    let command = std::env::args().nth(1).unwrap_or_else(|| "serve".into());
    match command.as_str() {
        "migrate" => {
            let db = sqlx::PgPool::connect(&config.database_url).await?;
            MIGRATOR.run(&db).await?;
            tracing::info!("migrations applied");
        }
        // İlk sistem adminini atamak için: `retfast-server grant-admin <email>`
        "grant-admin" => {
            let email = std::env::args().nth(2).ok_or_else(|| anyhow::anyhow!("usage: grant-admin <email>"))?;
            let db = sqlx::PgPool::connect(&config.database_url).await?;
            let n =
                sqlx::query("update users set is_system_admin = true where email = $1").bind(&email).execute(&db).await?.rows_affected();
            anyhow::ensure!(n == 1, "no user with email {email}");
            tracing::info!(%email, "system admin granted");
        }
        "serve" => {
            let bind: SocketAddr = config.bind.parse()?;
            let state = AppState::connect(config).await?;
            let listener = tokio::net::TcpListener::bind(bind).await?;
            tracing::info!(%bind, "retfast api listening");
            axum::serve(listener, routes::app(state).into_make_service_with_connect_info::<SocketAddr>())
                .with_graceful_shutdown(async {
                    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).unwrap();
                    tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term.recv() => {} }
                })
                .await?;
        }
        other => anyhow::bail!("unknown command: {other} (serve | migrate | grant-admin <email>)"),
    }
    Ok(())
}
