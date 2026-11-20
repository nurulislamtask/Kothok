//! Speech-to-text adapter: any server implementing `POST {base}/audio/transcriptions`
//! (OpenAI, Groq, and self-hosted Whisper servers that copy the OpenAI API).

use reqwest::multipart::{Form, Part};
use serde::Serialize;
use serde_json::Value;

use super::http::{check, client, map_send_error, read_json};
use super::{openai_compat, ProviderRecord};
use crate::error::AppError;

/// Upload limit of the common hosted services (Groq free tier / OpenAI are 25 MB).
pub const MAX_UPLOAD_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SttSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    /// Speaker label when the service separated speakers (for example "spk_1").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SttOutput {
    pub text: String,
    pub language: Option<String>,
    pub segments: Vec<SttSegment>,
    /// False when the service returned plain text only (no timestamps).
    pub has_timing: bool,
}

pub async fn transcribe(
    p: &ProviderRecord,
    key: Option<&str>,
    model: &str,
    lang: Option<&str>,
    file_name: &str,
    mime: &str,
    bytes: Vec<u8>,
    diarize: bool,
) -> Result<SttOutput, AppError> {
    if p.adapter == "gemini_stt" {
        return super::gemini_media::transcribe(p, key, model, lang, mime, &bytes, diarize).await;
    }
    let part = Part::bytes(bytes)
        .file_name(file_name.to_string())
        .mime_str(mime)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    let mut form = Form::new()
        .part("file", part)
        .text("model", model.to_string())
        .text("response_format", "verbose_json")
        .text("timestamp_granularities[]", "segment");
    if let Some(l) = lang.filter(|l| !l.is_empty()) {
        form = form.text("language", l.to_string());
    }
    let mut rb = client()
        .post(format!("{}/audio/transcriptions", openai_compat::base(p)?))
        .timeout(std::time::Duration::from_secs(900))
        .multipart(form);
    if let Some(k) = key {
        rb = rb.bearer_auth(k);
    }
    let v = read_json(check(rb.send().await.map_err(map_send_error)?).await?).await?;
    parse_transcription(&v)
}

pub fn parse_transcription(v: &Value) -> Result<SttOutput, AppError> {
    let text = v
        .get("text")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let language = v.get("language").and_then(|l| l.as_str()).map(String::from);
    let mut segments: Vec<SttSegment> = v
        .get("segments")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    let t = s.get("text")?.as_str()?.trim().to_string();
                    if t.is_empty() {
                        return None;
                    }
                    let start = s.get("start")?.as_f64()?;
                    let end = s.get("end")?.as_f64()?;
                    Some(SttSegment {
                        start_ms: (start * 1000.0).round() as i64,
                        end_ms: (end * 1000.0).round() as i64,
                        text: t,
                        speaker: None,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let has_timing = !segments.is_empty();
    if !has_timing && !text.is_empty() {
        segments.push(SttSegment {
            start_ms: 0,
            end_ms: 0,
            text: text.clone(),
            speaker: None,
        });
    }
    if text.is_empty() && segments.is_empty() {
        return Err(AppError::BadResponse("no speech was recognised".into()));
    }
    let text = if text.is_empty() {
        segments
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        text
    };
    Ok(SttOutput {
        text,
        language,
        segments,
        has_timing,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_verbose_json() {
        let v = json!({"text":" আমি ভালো আছি ","language":"bengali","segments":[
            {"start":0.0,"end":1.24,"text":" আমি "},{"start":1.24,"end":2.5,"text":"ভালো আছি"},
            {"start":2.5,"end":3.0,"text":"  "}]});
        let o = parse_transcription(&v).unwrap();
        assert!(o.has_timing);
        assert_eq!(o.segments.len(), 2);
        assert_eq!(o.segments[0].end_ms, 1240);
        assert_eq!(o.language.as_deref(), Some("bengali"));
    }

    #[test]
    fn text_only_response_has_no_timing() {
        let o = parse_transcription(&json!({"text":"hello"})).unwrap();
        assert!(!o.has_timing);
        assert_eq!(o.segments.len(), 1);
    }

    #[test]
    fn empty_response_is_an_error() {
        assert!(parse_transcription(&json!({"text":""})).is_err());
    }
}
