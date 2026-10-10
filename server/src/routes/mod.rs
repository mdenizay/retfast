use std::time::Duration;

use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{HeaderValue, Method, StatusCode, header},
};
use tower_http::{cors::CorsLayer, timeout::TimeoutLayer, trace::TraceLayer};

use crate::state::AppState;

mod account;
mod admin;
mod applications;
mod events;
mod ops;
mod tracking;
mod ws;

pub fn app(state: AppState) -> Router {
    let v1 = Router::new()
        .merge(account::router())
        .merge(events::router())
        .merge(applications::router())
        .merge(tracking::router())
        .merge(ops::router())
        .merge(admin::router())
        .layer(TimeoutLayer::with_status_code(StatusCode::GATEWAY_TIMEOUT, Duration::from_secs(20)))
        // Zaman aşımı WS'e uygulanmaz.
        .merge(ws::router());

    let mut app = Router::new()
        .nest("/v1", v1)
        .route("/health", axum::routing::get(|| async { "ok" }))
        .layer(DefaultBodyLimit::max(256 * 1024))
        .layer(TraceLayer::new_for_http());
    if !state.config.cors_origins.is_empty() {
        let origins: Vec<HeaderValue> = state.config.cors_origins.iter().filter_map(|o| o.parse().ok()).collect();
        app = app.layer(
            CorsLayer::new()
                .allow_origin(origins)
                .allow_credentials(true)
                .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE])
                .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]),
        );
    }
    app.with_state(state)
}
