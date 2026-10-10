use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

/// API hata sözleşmesi: `{ "error": { "code", "message" } }`. `code` istemcide çevrilir.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("authentication required")]
    Unauthorized,
    #[error("not allowed")]
    Forbidden,
    #[error("not found")]
    NotFound,
    #[error("{1}")]
    Conflict(&'static str, &'static str),
    #[error("{0}")]
    Validation(String),
    #[error("too many requests")]
    RateLimited,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Redis(#[from] redis::RedisError),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

pub type AppResult<T> = Result<T, AppError>;

pub fn invalid(msg: impl Into<String>) -> AppError {
    AppError::Validation(msg.into())
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", self.to_string()),
            AppError::Forbidden => (StatusCode::FORBIDDEN, "FORBIDDEN", self.to_string()),
            AppError::NotFound => (StatusCode::NOT_FOUND, "NOT_FOUND", self.to_string()),
            AppError::Conflict(code, _) => (StatusCode::CONFLICT, *code, self.to_string()),
            AppError::Validation(_) => (StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION", self.to_string()),
            AppError::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED", self.to_string()),
            AppError::Db(sqlx::Error::RowNotFound) => (StatusCode::NOT_FOUND, "NOT_FOUND", "not found".into()),
            AppError::Db(_) | AppError::Redis(_) | AppError::Other(_) => {
                tracing::error!(error = ?self, "internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL", "internal error".into())
            }
        };
        (status, Json(json!({ "error": { "code": code, "message": message } }))).into_response()
    }
}
