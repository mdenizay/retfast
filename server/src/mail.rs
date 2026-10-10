//! Resend üzerinden işlemsel e-posta. Anahtar yoksa yalnızca loglar (geliştirme ortamı).
use serde_json::json;

use crate::state::AppState;

fn send(state: &AppState, to: String, subject: String, text: String) {
    let state = state.clone();
    tokio::spawn(async move {
        let Some(key) = state.config.resend_api_key.as_deref() else {
            tracing::info!(%to, %subject, "mail (not sent: RESEND_API_KEY is not set)");
            return;
        };
        let res = state
            .http
            .post("https://api.resend.com/emails")
            .bearer_auth(key)
            .timeout(std::time::Duration::from_secs(10))
            .json(&json!({ "from": state.config.mail_from, "to": [to], "subject": subject, "text": text }))
            .send()
            .await;
        match res {
            Ok(r) if r.status().is_success() => {}
            Ok(r) => tracing::warn!(status = %r.status(), "mail: resend rejected"),
            Err(e) => tracing::warn!(error = %e, "mail: send failed"),
        }
    });
}

pub fn application_decided(state: &AppState, to: String, locale: &str, event: &str, role: Option<&str>) {
    let url = &state.config.public_web_url;
    let (subject, text) = match (locale, role) {
        ("tr", Some(role)) => {
            (format!("{event}: başvurun kabul edildi"), format!("{event} etkinliğine {role} olarak kabul edildin.\n\n{url}"))
        }
        ("tr", None) => (format!("{event}: başvurun hakkında"), format!("{event} etkinliğine yaptığın başvuru kabul edilmedi.\n\n{url}")),
        (_, Some(role)) => {
            (format!("{event}: your application was accepted"), format!("You have been accepted to {event} as {role}.\n\n{url}"))
        }
        (_, None) => (format!("{event}: about your application"), format!("Your application to {event} was not accepted.\n\n{url}")),
    };
    send(state, to, subject, text);
}
