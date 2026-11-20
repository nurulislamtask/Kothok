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
    let retry_header = resp
        .headers()
        .get("retry-after")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.trim().parse::<u64>().ok());
    let body = resp.text().await.unwrap_or_default();
    // Gemini reports a bad key as HTTP 400 rather than 401.
    let bad_key_body = body.contains("API_KEY_INVALID") || body.contains("API key not valid");
    Err(match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => AppError::InvalidKey,
        StatusCode::BAD_REQUEST if bad_key_body => AppError::InvalidKey,
        StatusCode::TOO_MANY_REQUESTS => AppError::Quota(Some(retry_seconds(retry_header, &body))),
        _ => AppError::Provider(format!(
            "HTTP {}: {}",
            status.as_u16(),
            truncate(&body, 300)
        )),
    })
}

/// How long to leave a rate-limited key alone: the provider's own hint when it gives one
/// (`Retry-After` header or Gemini's `"retryDelay": "34s"`), otherwise a cautious guess. Daily
/// quotas have no exact time in the reply, so those keys are simply re-tried after 30 minutes.
pub fn retry_seconds(header: Option<u64>, body: &str) -> u64 {
    if let Some(h) = header {
        return h.clamp(5, 86_400);
    }
    if let Some(i) = body.find("\"retryDelay\"") {
        let rest = &body[i + 12..];
        let digits: String = rest
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        if let Ok(s) = digits.parse::<f64>() {
            return (s.ceil() as u64).clamp(5, 86_400);
        }
    }
    if body.contains("PerDay") || body.to_ascii_lowercase().contains("daily") {
        return 1800;
    }
    60
}

pub async fn read_json(resp: Response) -> Result<serde_json::Value, AppError> {
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| AppError::BadResponse(e.to_string()))
}

#[cfg(test)]
mod retry_tests {
    use super::retry_seconds;

    #[test]
    fn reads_hints() {
        assert_eq!(retry_seconds(Some(12), ""), 12);
        assert_eq!(
            retry_seconds(None, r#"{"details":[{"retryDelay": "34s"}]}"#),
            34
        );
        assert_eq!(
            retry_seconds(None, "GenerateRequestsPerDayPerProjectPerModel-FreeTier"),
            1800
        );
        assert_eq!(retry_seconds(None, "slow down"), 60);
        assert_eq!(retry_seconds(Some(0), ""), 5);
    }
}
