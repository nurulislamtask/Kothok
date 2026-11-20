//! Image generation adapters.
//!
//! * `openai_images` – any server implementing `POST {base}/images/generations`.
//! * `gemini_image`  – Google's Gemini API "interactions" endpoint with an image response.
//!
//! Providers are billed per image on most services, so these are never marked free by default.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

use super::http::{check, client, map_send_error, read_json};
use super::{openai_compat, ProviderRecord};
use crate::error::AppError;

const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com";

pub struct ImageRequest {
    pub model: String,
    pub prompt: String,
    /// e.g. "1024x1024" (OpenAI-style providers only)
    pub size: Option<String>,
    /// e.g. "16:9" (Gemini only)
    pub aspect: Option<String>,
    /// Reference images the result should follow (Gemini only, at most 4).
    pub references: Vec<ReferenceImage>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceImage {
    pub mime: String,
    pub data_b64: String,
}

pub const MAX_REFERENCES: usize = 4;
const MAX_REFERENCE_B64: usize = 12 * 1024 * 1024;

/// The `input` of an Interactions request: plain text, or text plus image blocks.
pub fn build_gemini_input(prompt: &str, refs: &[ReferenceImage]) -> Value {
    if refs.is_empty() {
        return json!(prompt);
    }
    let mut parts = vec![json!({ "type": "text", "text": prompt })];
    for r in refs {
        parts.push(json!({ "type": "image", "data": r.data_b64, "mime_type": r.mime }));
    }
    Value::Array(parts)
}

pub struct ImageOut {
    pub data_b64: String,
    pub mime: String,
}

pub async fn generate_image(
    p: &ProviderRecord,
    key: Option<&str>,
    req: &ImageRequest,
) -> Result<ImageOut, AppError> {
    match p.adapter.as_str() {
        "openai_images" => openai_images(p, key, req).await,
        "gemini_image" => gemini_image(p, key, req).await,
        other => Err(AppError::Invalid(format!("unknown adapter {other}"))),
    }
}

async fn openai_images(
    p: &ProviderRecord,
    key: Option<&str>,
    req: &ImageRequest,
) -> Result<ImageOut, AppError> {
    if !req.references.is_empty() {
        return Err(AppError::Invalid(
            "reference images need a Gemini image model".into(),
        ));
    }
    let base = openai_compat::base(p)?;
    let mut body = json!({ "model": req.model, "prompt": req.prompt, "n": 1 });
    if let Some(s) = req.size.as_deref().filter(|s| !s.is_empty()) {
        body["size"] = json!(s);
    }
    let mut rb = client()
        .post(format!("{base}/images/generations"))
        .json(&body);
    if let Some(k) = key {
        rb = rb.bearer_auth(k);
    }
    let v = read_json(check(rb.send().await.map_err(map_send_error)?).await?).await?;
    let item = v
        .pointer("/data/0")
        .ok_or_else(|| AppError::BadResponse("no image in response".into()))?;

    if let Some(b64) = item.get("b64_json").and_then(|x| x.as_str()) {
        return Ok(ImageOut {
            data_b64: b64.to_string(),
            mime: sniff_mime_b64(b64),
        });
    }
    if let Some(url) = item.get("url").and_then(|x| x.as_str()) {
        return download_image(url).await;
    }
    Err(AppError::BadResponse("no image in response".into()))
}

/// Some providers return a URL instead of inline data.
async fn download_image(url: &str) -> Result<ImageOut, AppError> {
    super::validate_endpoint(url)?;
    let resp = check(client().get(url).send().await.map_err(map_send_error)?).await?;
    if resp.content_length().is_some_and(|n| n > MAX_IMAGE_BYTES) {
        return Err(AppError::BadResponse("image is too large".into()));
    }
    let header_mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or("").trim().to_string())
        .filter(|s| s.starts_with("image/"));
    let bytes = resp.bytes().await.map_err(map_send_error)?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(AppError::BadResponse("image is too large".into()));
    }
    let mime = header_mime.unwrap_or_else(|| sniff_mime(&bytes));
    Ok(ImageOut {
        data_b64: STANDARD.encode(&bytes),
        mime,
    })
}

async fn gemini_image(
    p: &ProviderRecord,
    key: Option<&str>,
    req: &ImageRequest,
) -> Result<ImageOut, AppError> {
    let key = key.ok_or(AppError::InvalidKey)?;
    let base = match p
        .endpoint
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(e) => {
            super::validate_endpoint(e)?;
            e.trim_end_matches('/').to_string()
        }
        None => GEMINI_BASE.to_string(),
    };
    let mut format = json!({ "type": "image" });
    if let Some(a) = req.aspect.as_deref().filter(|a| !a.is_empty()) {
        format["aspect_ratio"] = json!(a);
    }
    if req.references.len() > MAX_REFERENCES
        || req.references.iter().any(|r| {
            !matches!(r.mime.as_str(), "image/png" | "image/jpeg" | "image/webp")
                || r.data_b64.len() > MAX_REFERENCE_B64
        })
    {
        return Err(AppError::Invalid(
            "use up to 4 PNG, JPEG or WebP reference images under 9 MB each".into(),
        ));
    }
    let body = json!({
        "model": req.model,
        "input": build_gemini_input(&req.prompt, &req.references),
        "response_format": format
    });
    let resp = client()
        .post(format!("{base}/v1beta/interactions"))
        .header("x-goog-api-key", key)
        .json(&body)
        .send()
        .await
        .map_err(map_send_error)?;
    let v = read_json(check(resp).await?).await?;
    find_image(&v).ok_or_else(|| AppError::BadResponse("no image in response".into()))
}

/// Walk a JSON response looking for an image block, tolerating the several
/// shapes Google uses (`{type:"image", data}` or `inlineData{mimeType,data}`).
pub fn find_image(v: &Value) -> Option<ImageOut> {
    match v {
        Value::Object(map) => {
            let is_image = map.get("type").and_then(|t| t.as_str()) == Some("image");
            if is_image {
                if let Some(data) = map.get("data").and_then(|d| d.as_str()) {
                    let mime = map
                        .get("mime_type")
                        .or_else(|| map.get("mimeType"))
                        .and_then(|m| m.as_str())
                        .map(String::from)
                        .unwrap_or_else(|| sniff_mime_b64(data));
                    return Some(ImageOut {
                        data_b64: data.to_string(),
                        mime,
                    });
                }
            }
            for key in ["inlineData", "inline_data"] {
                if let Some(inner) = map.get(key).and_then(|x| x.as_object()) {
                    if let Some(data) = inner.get("data").and_then(|d| d.as_str()) {
                        let mime = inner
                            .get("mimeType")
                            .or_else(|| inner.get("mime_type"))
                            .and_then(|m| m.as_str())
                            .map(String::from)
                            .unwrap_or_else(|| sniff_mime_b64(data));
                        return Some(ImageOut {
                            data_b64: data.to_string(),
                            mime,
                        });
                    }
                }
            }
            map.values().find_map(find_image)
        }
        Value::Array(items) => items.iter().find_map(find_image),
        _ => None,
    }
}

fn sniff_mime(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg".into()
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp".into()
    } else {
        "image/png".into()
    }
}

fn sniff_mime_b64(b64: &str) -> String {
    // Decode only the first few bytes.
    let head: String = b64.chars().take(16).collect();
    match STANDARD.decode(head.as_bytes()) {
        Ok(b) => sniff_mime(&b),
        Err(_) => "image/png".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_interactions_style_image() {
        let v = json!({"steps":[{"type":"model_output","content":[{"type":"text","text":"hi"},{"type":"image","data":"iVBORw0KGgo=","mime_type":"image/png"}]}]});
        let img = find_image(&v).expect("image");
        assert_eq!(img.mime, "image/png");
        assert_eq!(img.data_b64, "iVBORw0KGgo=");
    }

    #[test]
    fn finds_inline_data_style_image() {
        let v = json!({"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/jpeg","data":"/9j/4AAQ"}}]}}]});
        let img = find_image(&v).expect("image");
        assert_eq!(img.mime, "image/jpeg");
    }

    #[test]
    fn no_image_returns_none() {
        assert!(find_image(&json!({"steps":[{"type":"text","text":"nope"}]})).is_none());
    }

    #[test]
    fn mime_sniffing() {
        assert_eq!(sniff_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), "image/jpeg");
        assert_eq!(sniff_mime(b"RIFFxxxxWEBPyyyy"), "image/webp");
        assert_eq!(sniff_mime(&[0x89, b'P', b'N', b'G']), "image/png");
    }
}

#[cfg(test)]
mod reference_tests {
    use super::*;

    #[test]
    fn plain_prompt_stays_a_string_and_references_become_blocks() {
        assert_eq!(build_gemini_input("hi", &[]), json!("hi"));
        let r = ReferenceImage {
            mime: "image/png".into(),
            data_b64: "AAAA".into(),
        };
        let v = build_gemini_input("edit", &[r]);
        assert_eq!(v[0]["type"], "text");
        assert_eq!(v[1]["type"], "image");
        assert_eq!(v[1]["mime_type"], "image/png");
        assert_eq!(v[1]["data"], "AAAA");
    }
}
