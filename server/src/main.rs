use std::net::SocketAddr;

use retfast_server::{MIGRATOR, config::Config, routes, state::AppState};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let dotenv = dotenvy::dotenv();
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,tower_http=info,sqlx=warn".into());
    if std::env::var("LOG_FORMAT").as_deref() == Ok("json") {
        tracing_subscriber::fmt().json().with_env_filter(filter).init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }

    if let Err(e) = &dotenv
        && !e.not_found()
    {
        tracing::warn!(error = %e, ".env could not be parsed; later variables were ignored");
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
        // Toplu hesap açma (test/davet). stdin: `email,ad,soyad[,admin]` satırları.
        // Şifreler rastgele üretilir ve yalnızca bir kez yazdırılır; var olan e-postalar atlanır.
        "create-users" => {
            let db = sqlx::PgPool::connect(&config.database_url).await?;
            let mut input = String::new();
            std::io::Read::read_to_string(&mut std::io::stdin(), &mut input)?;
            println!("{:<34} {:<28} PASSWORD", "EMAIL", "NAME");
            for line in input.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')) {
                let cols: Vec<&str> = line.split(',').map(str::trim).collect();
                let [email, first, last, rest @ ..] = cols.as_slice() else {
                    anyhow::bail!("bad line (expected email,first,last[,admin]): {line}");
                };
                let email = email.to_lowercase();
                anyhow::ensure!(email.contains('@') && !first.is_empty() && !last.is_empty(), "bad line: {line}");
                let admin = rest.first().is_some_and(|v| *v == "admin");
                let password = retfast_server::auth::new_token()[..14].to_string();
                let hash = retfast_server::auth::hash_password(password.clone()).await?;
                let created = sqlx::query(
                    "insert into users (id, email, password_hash, first_name, last_name, locale, is_system_admin)
                     values ($1, $2, $3, $4, $5, 'tr', $6) on conflict (email) do nothing",
                )
                .bind(uuid::Uuid::now_v7())
                .bind(&email)
                .bind(hash)
                .bind(first)
                .bind(last)
                .bind(admin)
                .execute(&db)
                .await?
                .rows_affected();
                let name = format!("{first} {last}{}", if admin { " (admin)" } else { "" });
                if created == 1 {
                    println!("{email:<34} {name:<28} {password}");
                } else {
                    println!("{email:<34} {name:<28} (already exists, unchanged)");
                }
            }
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
        other => anyhow::bail!("unknown command: {other} (serve | migrate | grant-admin <email> | create-users < csv)"),
    }
    Ok(())
}
