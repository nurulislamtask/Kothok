//! Any server speaking the OpenAI REST dialect: OpenRouter, Ollama, LM Studio, Groq, etc.

use serde_json::json;

use super::http::{check, client, map_send_error, read_json};
use super::{ModelInfo, ProviderRecord, TextRequest};
use crate::error::AppError;

pub(super) fn base(p: &ProviderRecord) -> Result<String, AppError> {
    let e = p
        .endpoint
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Invalid("endpoint is required".into()))?;
    super::validate_endpoint(e)?;
    Ok(e.trim_end_matches('/').to_string())
}

pub async fn list_models(
    p: &ProviderRecord,
    key: Option<&str>,
) -> Result<Vec<ModelInfo>, AppError> {
    let mut rb = client().get(format!("{}/models", base(p)?));
    if let Some(k) = key {
        rb = rb.bearer_auth(k);
    }
    let resp = check(rb.send().await.map_err(map_send_error)?).await?;
    let v = read_json(resp).await?;
    let mut out: Vec<ModelInfo> = v
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let id = m.get("id")?.as_str()?.to_string();
                    let display_name = m.get("name").and_then(|n| n.as_str()).map(String::from);
                    Some(ModelInfo {
                        free: is_free(m, &id),
                        id,
                        display_name,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    super::sort_free_first(&mut out);
    Ok(out)
}

/// OpenRouter lists `pricing` (strings, "0" = free) and marks free variants with a `:free` suffix.
/// Providers that publish neither (OpenAI, Groq, local servers) stay `None` (unknown).
pub(super) fn is_free(m: &serde_json::Value, id: &str) -> Option<bool> {
    if id.ends_with(":free") {
        return Some(true);
    }
    let price = |k: &str| {
        m.pointer(&format!("/pricing/{k}")).and_then(|v| {
            v.as_str()
                .map(String::from)
                .or_else(|| v.as_f64().map(|n| n.to_string()))
        })
    };
    let (p, c) = (price("prompt")?, price("completion")?);
    let zero = |s: &str| s.parse::<f64>().map(|n| n == 0.0).unwrap_or(false);
    Some(zero(&p) && zero(&c))
}

#[cfg(test)]
mod free_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn detects_free_models() {
        assert_eq!(is_free(&json!({}), "x/y:free"), Some(true));
        assert_eq!(
            is_free(&json!({"pricing":{"prompt":"0","completion":"0"}}), "a"),
            Some(true)
        );
        assert_eq!(
            is_free(
                &json!({"pricing":{"prompt":"0.000001","completion":"0"}}),
                "a"
            ),
            Some(false)
        );
        assert_eq!(is_free(&json!({"id":"gpt"}), "gpt"), None);
    }
}

pub async fn generate_text(
    p: &ProviderRecord,
    key: Option<&str>,
    req: &TextRequest,
) -> Result<String, AppError> {
    let mut messages = Vec::new();
    if let Some(s) = &req.system {
        messages.push(json!({ "role": "system", "content": s }));
    }
    messages.push(json!({ "role": "user", "content": req.prompt }));

    let mut body = json!({ "model": req.model, "messages": messages, "stream": false });
    if let Some(t) = req.temperature {
        body["temperature"] = json!(t);
    }
    if let Some(m) = req.max_tokens {
        body["max_tokens"] = json!(m);
    }

    let mut rb = client()
        .post(format!("{}/chat/completions", base(p)?))
        .json(&body);
    if let Some(k) = key {
        rb = rb.bearer_auth(k);
    }
    let resp = check(rb.send().await.map_err(map_send_error)?).await?;
    let v = read_json(resp).await?;
    let text = v
        .pointer("/choices/0/message/content")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    if text.trim().is_empty() {
        return Err(AppError::EmptyReply);
    }
    Ok(text)
}
