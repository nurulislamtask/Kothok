//! Provider adapters. Each adapter is a module exposing the same free functions;
//! `list_models` / `generate_text` dispatch on `ProviderRecord::adapter`.
//! Adding a provider = add a module + one match arm here + one entry in ADAPTERS.

pub mod elevenlabs;
pub mod gemini;
pub mod gemini_media;
mod http;
pub mod image_gen;
pub mod openai_compat;
pub mod stt;
pub mod tts;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Adapters that exist for each provider category. A category with no adapters
/// cannot be configured yet, so the UI never offers something that cannot work.
pub fn adapters_for(category: &str) -> &'static [&'static str] {
    match category {
        "text" => &["gemini", "openai_compat"],
        "image" => &["gemini_image", "openai_images"],
        "tts" => &["gemini_tts", "google_tts", "openai_tts"],
        "stt" => &["gemini_stt", "openai_stt", "whisper_local"],
        "clone" => &["elevenlabs_clone"],
        _ => &[],
    }
}

/// Adapters that talk to a user-supplied OpenAI-style base URL.
/// The provider record that actually holds the API key. A provider created with
/// "use this key for another job" points at the original through `keyFrom`.
pub fn key_owner(p: &ProviderRecord) -> String {
    p.settings_json
        .as_deref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|v| v.get("keyFrom").and_then(|k| k.as_str()).map(String::from))
        .filter(|k| !k.is_empty())
        .unwrap_or_else(|| p.id.clone())
}

/// The API key for a provider, following `keyFrom`.
pub fn key_for(p: &ProviderRecord) -> Result<Option<String>, AppError> {
    crate::credentials::get(&key_owner(p))
}

fn has_any(id: &str, words: &[&str]) -> bool {
    let id = id.to_ascii_lowercase();
    words.iter().any(|w| id.contains(w))
}

/// Keep the models that fit this provider's job (a TTS model is useless for writing text).
/// If the filter would remove everything, the full list is returned instead.
pub fn filter_models(category: &str, models: Vec<ModelInfo>) -> Vec<ModelInfo> {
    let keep = |m: &ModelInfo| -> bool {
        let id = &m.id;
        match category {
            "tts" => has_any(id, &["tts", "speech"]),
            "image" => has_any(id, &["image", "imagen", "dall-e", "dalle"]),
            "stt" => {
                has_any(id, &["whisper", "transcribe", "stt"])
                    || !has_any(
                        id,
                        &[
                            "tts",
                            "image",
                            "imagen",
                            "embed",
                            "veo",
                            "moderation",
                            "dall-e",
                            "speech",
                        ],
                    )
            }
            "text" => !has_any(
                id,
                &[
                    "tts",
                    "speech",
                    "image",
                    "imagen",
                    "embed",
                    "veo",
                    "whisper",
                    "transcribe",
                    "moderation",
                    "dall-e",
                    "aqa",
                    "guard",
                ],
            ),
            _ => true,
        }
    };
    let kept: Vec<ModelInfo> = models.iter().filter(|m| keep(m)).cloned().collect();
    if kept.is_empty() {
        models
    } else {
        kept
    }
}

/// Which adapter does the same job in another category with the same kind of key?
pub fn linked_adapter(source_adapter: &str, category: &str) -> Option<&'static str> {
    match (source_adapter, category) {
        ("gemini" | "gemini_image" | "gemini_tts" | "gemini_stt", "text") => Some("gemini"),
        ("gemini" | "gemini_image" | "gemini_tts" | "gemini_stt", "image") => Some("gemini_image"),
        ("gemini" | "gemini_image" | "gemini_tts" | "gemini_stt", "tts") => Some("gemini_tts"),
        ("gemini" | "gemini_image" | "gemini_tts" | "gemini_stt", "stt") => Some("gemini_stt"),
        ("openai_compat" | "openai_images" | "openai_tts" | "openai_stt", "text") => {
            Some("openai_compat")
        }
        ("openai_compat" | "openai_images" | "openai_tts" | "openai_stt", "image") => {
            Some("openai_images")
        }
        ("openai_compat" | "openai_images" | "openai_tts" | "openai_stt", "tts") => {
            Some("openai_tts")
        }
        ("openai_compat" | "openai_images" | "openai_tts" | "openai_stt", "stt") => {
            Some("openai_stt")
        }
        _ => None,
    }
}

/// Best starting model from a synced list: the newest-looking "flash"/"mini" style model first.
pub fn pick_default_model(category: &str, models: &[ModelInfo]) -> Option<String> {
    let prefs: &[&str] = match category {
        "text" | "stt" => &["flash", "mini", "turbo", "versatile"],
        "clone" => &["v3"],
        _ => &[],
    };
    for pref in prefs {
        let mut hits: Vec<&ModelInfo> = models
            .iter()
            .filter(|m| {
                m.id.to_ascii_lowercase().contains(pref)
                    && !has_any(&m.id, &["lite", "preview-0", "exp"])
            })
            .collect();
        hits.sort_by(|a, b| b.id.cmp(&a.id));
        if let Some(m) = hits.first() {
            return Some(m.id.clone());
        }
    }
    models.first().map(|m| m.id.clone())
}

pub fn needs_endpoint(adapter: &str) -> bool {
    matches!(
        adapter,
        "openai_compat" | "openai_images" | "openai_tts" | "openai_stt"
    )
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
        "gemini" | "gemini_image" | "gemini_tts" | "gemini_stt" => gemini::list_models(p, key)
            .await
            .map(|m| filter_models(&p.category, m)),
        "openai_compat" | "openai_images" | "openai_tts" | "openai_stt" => {
            openai_compat::list_models(p, key)
                .await
                .map(|m| filter_models(&p.category, m))
        }
        // Google Cloud TTS has no model list; a successful voice listing proves the key works.
        "google_tts" => tts::check_access(p, key).await.map(|_| Vec::new()),
        "elevenlabs_clone" => elevenlabs::list_models(key).await,
        // Local engine: the model names whisper.cpp publishes; install them in Settings → Tools.
        "whisper_local" => Ok(["base", "small", "medium"]
            .iter()
            .map(|m| ModelInfo {
                id: (*m).to_string(),
                display_name: None,
            })
            .collect()),
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

#[cfg(test)]
mod model_tests {
    use super::*;

    fn m(id: &str) -> ModelInfo {
        ModelInfo {
            id: id.into(),
            display_name: None,
        }
    }

    #[test]
    fn filters_models_by_job() {
        let all = vec![
            m("gemini-2.5-flash"),
            m("gemini-2.5-flash-preview-tts"),
            m("gemini-2.5-flash-image"),
            m("text-embedding-004"),
        ];
        let ids = |c: &str| {
            filter_models(c, all.clone())
                .into_iter()
                .map(|x| x.id)
                .collect::<Vec<_>>()
        };
        assert_eq!(ids("text"), vec!["gemini-2.5-flash"]);
        assert_eq!(ids("tts"), vec!["gemini-2.5-flash-preview-tts"]);
        assert_eq!(ids("image"), vec!["gemini-2.5-flash-image"]);
        assert_eq!(ids("stt"), vec!["gemini-2.5-flash"]);
    }

    #[test]
    fn empty_filter_falls_back_to_everything() {
        assert_eq!(filter_models("tts", vec![m("llama-3")]).len(), 1);
    }

    #[test]
    fn key_owner_follows_key_from() {
        let mut p = ProviderRecord {
            id: "gemini_tts-1".into(),
            category: "tts".into(),
            adapter: "gemini_tts".into(),
            display_name: "x".into(),
            endpoint: None,
            enabled: true,
            cost_class: "free_tier".into(),
            settings_json: Some(r#"{"keyFrom":"gemini-abc","model":"m"}"#.into()),
            last_status: None,
            last_error: None,
            last_checked_at: None,
        };
        assert_eq!(key_owner(&p), "gemini-abc");
        p.settings_json = None;
        assert_eq!(key_owner(&p), "gemini_tts-1");
    }

    #[test]
    fn links_across_categories() {
        assert_eq!(linked_adapter("gemini", "tts"), Some("gemini_tts"));
        assert_eq!(
            linked_adapter("openai_compat", "image"),
            Some("openai_images")
        );
        assert_eq!(linked_adapter("google_tts", "text"), None);
    }

    #[test]
    fn default_model_prefers_flash() {
        let l = vec![
            m("gemini-2.0-flash-lite"),
            m("gemini-2.5-flash"),
            m("gemini-2.5-pro"),
        ];
        assert_eq!(
            pick_default_model("text", &l).as_deref(),
            Some("gemini-2.5-flash")
        );
        assert_eq!(
            pick_default_model("tts", &[m("a-tts")]).as_deref(),
            Some("a-tts")
        );
    }
}
