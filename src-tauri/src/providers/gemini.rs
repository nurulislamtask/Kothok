//! Google Gemini API (generativelanguage.googleapis.com). The key is sent in the
//! `x-goog-api-key` header, never in the URL.

use serde_json::json;

use super::http::{check, client, map_send_error, read_json};
use super::{ModelInfo, ProviderRecord, TextRequest};
use crate::error::AppError;

const DEFAULT_BASE: &str = "https://generativelanguage.googleapis.com";

fn base(p: &ProviderRecord) -> Result<String, AppError> {
    match p
        .endpoint
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(e) => {
            super::validate_endpoint(e)?;
            Ok(e.trim_end_matches('/').to_string())
        }
        None => Ok(DEFAULT_BASE.to_string()),
    }
}

fn valid_model_name(m: &str) -> bool {
    !m.is_empty()
        && m.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_'))
}

pub async fn list_models(
    p: &ProviderRecord,
    key: Option<&str>,
) -> Result<Vec<ModelInfo>, AppError> {
    let key = key.ok_or(AppError::InvalidKey)?;
    let resp = client()
        .get(format!("{}/v1beta/models?pageSize=1000", base(p)?))
        .header("x-goog-api-key", key)
        .send()
        .await
        .map_err(map_send_error)?;
    let v = read_json(check(resp).await?).await?;
    let mut out: Vec<ModelInfo> = v
        .get("models")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|m| {
                    m.get("supportedGenerationMethods")
                        .and_then(|s| s.as_array())
                        .map(|s| s.iter().any(|x| x.as_str() == Some("generateContent")))
                        .unwrap_or(false)
                })
                .filter_map(|m| {
                    let name = m.get("name")?.as_str()?;
                    let id = name.strip_prefix("models/").unwrap_or(name).to_string();
                    let display_name = m
                        .get("displayName")
                        .and_then(|n| n.as_str())
                        .map(String::from);
                    Some(ModelInfo { id, display_name })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

pub async fn generate_text(
    p: &ProviderRecord,
    key: Option<&str>,
    req: &TextRequest,
) -> Result<String, AppError> {
    let key = key.ok_or(AppError::InvalidKey)?;
    if !valid_model_name(&req.model) {
        return Err(AppError::Invalid("invalid model name".into()));
    }
    let mut body = json!({
        "contents": [{ "role": "user", "parts": [{ "text": req.prompt }] }],
        "generationConfig": {}
    });
    if let Some(s) = &req.system {
        body["systemInstruction"] = json!({ "parts": [{ "text": s }] });
    }
    if let Some(t) = req.temperature {
        body["generationConfig"]["temperature"] = json!(t);
    }
    if let Some(m) = req.max_tokens {
        body["generationConfig"]["maxOutputTokens"] = json!(m);
    }

    let resp = client()
        .post(format!(
            "{}/v1beta/models/{}:generateContent",
            base(p)?,
            req.model
        ))
        .header("x-goog-api-key", key)
        .json(&body)
        .send()
        .await
        .map_err(map_send_error)?;
    let v = read_json(check(resp).await?).await?;

    let text: String = v
        .pointer("/candidates/0/content/parts")
        .and_then(|p| p.as_array())
        .map(|parts| {
            parts
                .iter()
                .filter(|p| p.get("thought").and_then(|t| t.as_bool()) != Some(true))
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();

    if text.trim().is_empty() {
        let reason = v
            .pointer("/promptFeedback/blockReason")
            .and_then(|r| r.as_str())
            .or_else(|| {
                v.pointer("/candidates/0/finishReason")
                    .and_then(|r| r.as_str())
            })
            .unwrap_or("unknown");
        return Err(AppError::Provider(format!(
            "empty response (reason: {reason})"
        )));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::valid_model_name;

    #[test]
    fn model_names() {
        assert!(valid_model_name("gemini-2.5-flash"));
        assert!(!valid_model_name("a/b"));
        assert!(!valid_model_name("a:b"));
        assert!(!valid_model_name(""));
    }
}
