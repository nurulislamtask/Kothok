//! Provider adapters. Each adapter is a module exposing the same free functions;
//! `list_models` / `generate_text` dispatch on `ProviderRecord::adapter`.
//! Adding a provider = add a module + one match arm here + one entry in ADAPTERS.

pub mod gemini;
mod http;
pub mod image_gen;
pub mod openai_compat;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Adapters that exist for each provider category. A category with no adapters
/// cannot be configured yet, so the UI never offers something that cannot work.
pub fn adapters_for(category: &str) -> &'static [&'static str] {
    match category {
        "text" => &["gemini", "openai_compat"],
        "image" => &["gemini_image", "openai_images"],
        _ => &[],
    }
}

/// Adapters that talk to a user-supplied OpenAI-style base URL.
pub fn needs_endpoint(adapter: &str) -> bool {
    matches!(adapter, "openai_compat" | "openai_images")
}
pub const CATEGORIES: &[&str] = &["text", "image", "tts", "clone", "stt"];
pub const COST_CLASSES: &[&str] = &["local", "free", "free_tier", "paid"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRecord {
    pub id: String,
    pub category: String,
    pub adapter: String,
    pub display_name: String,
    pub endpoint: Option<String>,
    pub enabled: bool,
    pub cost_class: String,
    pub settings_json: Option<String>,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
    pub last_checked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub display_name: Option<String>,
}

pub struct TextRequest {
    pub model: String,
    pub system: Option<String>,
    pub prompt: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

/// Model chosen for this provider in the API Manager (`settings_json: {"model": "..."}`).
pub fn saved_model(p: &ProviderRecord) -> Option<String> {
    p.settings_json
        .as_deref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|v| v.get("model").and_then(|m| m.as_str()).map(String::from))
        .filter(|m| !m.trim().is_empty())
}

/// Keys must never travel over plain HTTP to a remote host. Plain HTTP is only
/// accepted for loopback addresses (local model servers).
pub fn validate_endpoint(endpoint: &str) -> Result<(), AppError> {
    let e = endpoint.trim();
    if e.starts_with("https://") {
        return Ok(());
    }
    if let Some(rest) = e.strip_prefix("http://") {
        let authority = rest.split('/').next().unwrap_or("");
        if authority.contains('@') {
            return Err(AppError::Invalid(
                "endpoint must not contain credentials".into(),
            ));
        }
        let host = if authority.starts_with('[') {
            authority
                .split(']')
                .next()
                .map(|h| format!("{h}]"))
                .unwrap_or_default()
        } else {
            authority.split(':').next().unwrap_or("").to_string()
        };
        if matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]") {
            return Ok(());
        }
        return Err(AppError::Invalid(
            "plain http:// is only allowed for localhost; use https://".into(),
        ));
    }
    Err(AppError::Invalid(
        "endpoint must start with https:// (or http://localhost)".into(),
    ))
}

pub async fn list_models(
    p: &ProviderRecord,
    key: Option<&str>,
) -> Result<Vec<ModelInfo>, AppError> {
    match p.adapter.as_str() {
        "gemini" | "gemini_image" => gemini::list_models(p, key).await,
        "openai_compat" | "openai_images" => openai_compat::list_models(p, key).await,
        other => Err(AppError::Invalid(format!("unknown adapter {other}"))),
    }
}

pub async fn generate_text(
    p: &ProviderRecord,
    key: Option<&str>,
    req: &TextRequest,
) -> Result<String, AppError> {
    match p.adapter.as_str() {
        "gemini" => gemini::generate_text(p, key, req).await,
        "openai_compat" => openai_compat::generate_text(p, key, req).await,
        other => Err(AppError::Invalid(format!("unknown adapter {other}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_rules() {
        assert!(validate_endpoint("https://openrouter.ai/api/v1").is_ok());
        assert!(validate_endpoint("http://localhost:11434/v1").is_ok());
        assert!(validate_endpoint("http://127.0.0.1:1234/v1").is_ok());
        assert!(validate_endpoint("http://[::1]:8080").is_ok());
        assert!(validate_endpoint("http://localhost.evil.com/v1").is_err());
        assert!(validate_endpoint("http://example.com").is_err());
        assert!(validate_endpoint("http://user@localhost/v1").is_err());
        assert!(validate_endpoint("ftp://x").is_err());
    }

    #[test]
    fn saved_model_parses() {
        let mut p = ProviderRecord {
            id: "x".into(),
            category: "text".into(),
            adapter: "gemini".into(),
            display_name: "X".into(),
            endpoint: None,
            enabled: true,
            cost_class: "free_tier".into(),
            settings_json: Some(r#"{"model":"abc"}"#.into()),
            last_status: None,
            last_error: None,
            last_checked_at: None,
        };
        assert_eq!(saved_model(&p).as_deref(), Some("abc"));
        p.settings_json = Some("not json".into());
        assert_eq!(saved_model(&p), None);
        p.settings_json = Some(r#"{"model":"  "}"#.into());
        assert_eq!(saved_model(&p), None);
    }
}
