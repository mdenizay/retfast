pub mod auth;
pub mod authz;
pub mod config;
pub mod error;
pub mod extract;
pub mod mail;
pub mod oplog;
pub mod realtime;
pub mod routes;
pub mod state;

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
