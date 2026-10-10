use axum::{
    body::Bytes,
    extract::{FromRequest, Request},
};
use serde::de::DeserializeOwned;

use crate::error::{AppError, invalid};

/// Gövdesi isteğe bağlı uçlar için JSON: boş gövde (Content-Type gönderilmiş olsa bile) varsayılan değerdir.
pub struct OptJson<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned + Default> FromRequest<S> for OptJson<T> {
    type Rejection = AppError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let bytes = Bytes::from_request(req, state).await.map_err(|_| invalid("request body is too large"))?;
        if bytes.iter().all(u8::is_ascii_whitespace) {
            return Ok(Self(T::default()));
        }
        serde_json::from_slice(&bytes).map(Self).map_err(|e| invalid(format!("invalid JSON body: {e}")))
    }
}
