use std::sync::OnceLock;
use std::time::Duration;

use reqwest::{Client, Response, StatusCode};

use crate::error::AppError;

pub fn client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(180))
            .build()
            .expect("failed to build HTTP client")
    })
}

/// Errors from reqwest can embed the request URL; strip it so nothing sensitive is shown.
pub fn map_send_error(e: reqwest::Error) -> AppError {
    AppError::Network(e.without_url().to_string())
}

pub fn truncate(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

/// Turn non-2xx responses into typed errors.
pub async fn check(resp: Response) -> Result<Response, AppError> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let body = resp.text().await.unwrap_or_default();
    // Gemini reports a bad key as HTTP 400 rather than 401.
    let bad_key_body = body.contains("API_KEY_INVALID") || body.contains("API key not valid");
    Err(match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => AppError::InvalidKey,
        StatusCode::BAD_REQUEST if bad_key_body => AppError::InvalidKey,
        StatusCode::TOO_MANY_REQUESTS => AppError::Quota,
        _ => AppError::Provider(format!(
            "HTTP {}: {}",
            status.as_u16(),
            truncate(&body, 300)
        )),
    })
}

pub async fn read_json(resp: Response) -> Result<serde_json::Value, AppError> {
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| AppError::BadResponse(e.to_string()))
}
