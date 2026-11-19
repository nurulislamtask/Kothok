//! ElevenLabs: instant voice cloning (`POST /v1/voices/add`) and speech with a cloned voice
//! (`POST /v1/text-to-speech/{voice_id}`). Bangla is only supported by the Eleven v3 model.

use reqwest::multipart::{Form, Part};
use serde_json::{json, Value};

use super::http::{check, client, map_send_error, read_json};
use super::ModelInfo;
use crate::error::AppError;

const BASE: &str = "https://api.elevenlabs.io";

fn key_of(key: Option<&str>) -> Result<&str, AppError> {
    key.filter(|k| !k.is_empty()).ok_or(AppError::InvalidKey)
}

fn id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

pub async fn list_models(key: Option<&str>) -> Result<Vec<ModelInfo>, AppError> {
    let resp = client()
        .get(format!("{BASE}/v1/models"))
        .header("xi-api-key", key_of(key)?)
        .send()
        .await
        .map_err(map_send_error)?;
    let v = read_json(check(resp).await?).await?;
    Ok(parse_models(&v))
}

pub fn parse_models(v: &Value) -> Vec<ModelInfo> {
    let mut out: Vec<ModelInfo> = v
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|m| {
                    m.get("can_do_text_to_speech")
                        .and_then(|b| b.as_bool())
                        .unwrap_or(true)
                })
                .filter_map(|m| {
                    Some(ModelInfo {
                        id: m.get("model_id")?.as_str()?.to_string(),
                        display_name: m.get("name").and_then(|n| n.as_str()).map(String::from),
                        free: None,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

/// Upload a consented sample and return the new voice id.
pub async fn create_voice(
    key: Option<&str>,
    name: &str,
    file_name: &str,
    mime: &str,
    bytes: Vec<u8>,
) -> Result<String, AppError> {
    let part = Part::bytes(bytes)
        .file_name(file_name.to_string())
        .mime_str(mime)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    let form = Form::new()
        .text("name", name.to_string())
        .part("files", part);
    let resp = client()
        .post(format!("{BASE}/v1/voices/add"))
        .header("xi-api-key", key_of(key)?)
        .timeout(std::time::Duration::from_secs(300))
        .multipart(form)
        .send()
        .await
        .map_err(map_send_error)?;
    let v = read_json(check(resp).await?).await?;
    v.get("voice_id")
        .and_then(|i| i.as_str())
        .filter(|i| id_ok(i))
        .map(String::from)
        .ok_or_else(|| AppError::BadResponse("no voice id in the response".into()))
}

pub async fn delete_voice(key: Option<&str>, voice_id: &str) -> Result<(), AppError> {
    if !id_ok(voice_id) {
        return Err(AppError::Invalid("invalid voice id".into()));
    }
    let resp = client()
        .delete(format!("{BASE}/v1/voices/{voice_id}"))
        .header("xi-api-key", key_of(key)?)
        .send()
        .await
        .map_err(map_send_error)?;
    check(resp).await.map(|_| ())
}

pub async fn synthesize(
    key: Option<&str>,
    voice_id: &str,
    model: &str,
    text: &str,
) -> Result<Vec<u8>, AppError> {
    if !id_ok(voice_id) {
        return Err(AppError::Invalid("invalid voice id".into()));
    }
    let resp = client()
        .post(format!("{BASE}/v1/text-to-speech/{voice_id}"))
        .query(&[("output_format", "mp3_44100_128")])
        .header("xi-api-key", key_of(key)?)
        .timeout(std::time::Duration::from_secs(300))
        .json(&json!({ "text": text, "model_id": model }))
        .send()
        .await
        .map_err(map_send_error)?;
    let bytes = check(resp)
        .await?
        .bytes()
        .await
        .map_err(|e| AppError::BadResponse(e.to_string()))?;
    if bytes.is_empty() {
        return Err(AppError::BadResponse(
            "the service returned no audio".into(),
        ));
    }
    Ok(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_models_and_skips_non_tts() {
        let v = json!([
            {"model_id":"eleven_v3","name":"Eleven v3","can_do_text_to_speech":true},
            {"model_id":"scribe_v1","name":"Scribe","can_do_text_to_speech":false}
        ]);
        let m = parse_models(&v);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].id, "eleven_v3");
    }

    #[test]
    fn voice_ids_are_validated() {
        assert!(id_ok("21m00Tcm4TlvDq8ikWAM"));
        assert!(!id_ok("../x"));
        assert!(!id_ok(""));
    }
}
