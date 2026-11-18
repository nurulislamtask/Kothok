//! Text-to-speech adapters.
//!
//! * `google_tts`  – Google Cloud Text-to-Speech (`voices.list`, `text:synthesize`). Needs a
//!   Cloud project with billing enabled; Gemini-TTS models are selected by saving a model id.
//! * `openai_tts`  – any server implementing `POST {base}/audio/speech`.
//!
//! Voices shown to the user are only what the provider actually returns.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::{json, Value};

use super::http::{check, client, map_send_error, read_json};
use super::{openai_compat, ProviderRecord};
use crate::error::AppError;

const GOOGLE_BASE: &str = "https://texttospeech.googleapis.com/v1";
const MAX_AUDIO_BYTES: usize = 60 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInfo {
    pub id: String,
    pub name: String,
    pub language_codes: Vec<String>,
    pub gender: Option<String>,
}

pub struct TtsRequest {
    pub voice_id: String,
    pub lang: Option<String>,
    pub model: Option<String>,
    pub text: String,
    pub speed: f32,
    pub pitch: f32,
}

pub struct AudioOut {
    pub bytes: Vec<u8>,
    pub ext: &'static str,
    pub chunks: usize,
}

fn google_key(key: Option<&str>) -> Result<&str, AppError> {
    key.filter(|k| !k.is_empty()).ok_or(AppError::InvalidKey)
}

/// Verifies the key by listing voices; returns the number of voices found.
pub async fn check_access(p: &ProviderRecord, key: Option<&str>) -> Result<usize, AppError> {
    match p.adapter.as_str() {
        "google_tts" => Ok(list_voices(p, key, None).await?.len()),
        "openai_tts" => openai_compat::list_models(p, key).await.map(|m| m.len()),
        other => Err(AppError::Invalid(format!("unknown adapter {other}"))),
    }
}

pub async fn list_voices(
    p: &ProviderRecord,
    key: Option<&str>,
    lang: Option<&str>,
) -> Result<Vec<VoiceInfo>, AppError> {
    match p.adapter.as_str() {
        "google_tts" => {
            let mut rb = client()
                .get(format!("{GOOGLE_BASE}/voices"))
                .header("x-goog-api-key", google_key(key)?);
            if let Some(l) = lang.filter(|l| !l.is_empty()) {
                rb = rb.query(&[("languageCode", l)]);
            }
            let v = read_json(check(rb.send().await.map_err(map_send_error)?).await?).await?;
            Ok(parse_google_voices(&v))
        }
        // OpenAI-style servers have no voice list endpoint; the user supplies a voice id.
        "openai_tts" => Ok(vec![]),
        other => Err(AppError::Invalid(format!("unknown adapter {other}"))),
    }
}

pub fn parse_google_voices(v: &Value) -> Vec<VoiceInfo> {
    let mut out: Vec<VoiceInfo> = v
        .get("voices")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| {
                    let name = x.get("name")?.as_str()?.to_string();
                    let language_codes = x
                        .get("languageCodes")
                        .and_then(|l| l.as_array())
                        .map(|l| {
                            l.iter()
                                .filter_map(|s| s.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    let gender = x
                        .get("ssmlGender")
                        .and_then(|g| g.as_str())
                        .filter(|g| *g != "SSML_VOICE_GENDER_UNSPECIFIED")
                        .map(|g| g.to_lowercase());
                    Some(VoiceInfo {
                        id: name.clone(),
                        name,
                        language_codes,
                        gender,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Split text at sentence/line boundaries so each piece is at most `max_bytes` UTF-8 bytes.
pub fn chunk_text(text: &str, max_bytes: usize) -> Vec<String> {
    let mut chunks: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut flush = |cur: &mut String, chunks: &mut Vec<String>| {
        if !cur.trim().is_empty() {
            chunks.push(cur.trim().to_string());
        }
        cur.clear();
    };
    let mut sentence = String::new();
    let mut pieces: Vec<String> = Vec::new();
    for ch in text.chars() {
        sentence.push(ch);
        if matches!(ch, '.' | '!' | '?' | '।' | '\n' | '؟') {
            pieces.push(std::mem::take(&mut sentence));
        }
    }
    if !sentence.is_empty() {
        pieces.push(sentence);
    }
    for piece in pieces {
        // A single sentence longer than the limit is cut on char boundaries.
        let mut rest = piece.as_str();
        while rest.len() > max_bytes {
            let mut cut = max_bytes;
            while !rest.is_char_boundary(cut) {
                cut -= 1;
            }
            flush(&mut cur, &mut chunks);
            chunks.push(rest[..cut].trim().to_string());
            rest = &rest[cut..];
        }
        if cur.len() + rest.len() > max_bytes {
            flush(&mut cur, &mut chunks);
        }
        cur.push_str(rest);
    }
    flush(&mut cur, &mut chunks);
    chunks.retain(|c| !c.is_empty());
    chunks
}

pub async fn synthesize(
    p: &ProviderRecord,
    key: Option<&str>,
    req: &TtsRequest,
) -> Result<AudioOut, AppError> {
    let limit = if p.adapter == "google_tts" {
        4000
    } else {
        3500
    };
    let parts = chunk_text(&req.text, limit);
    if parts.is_empty() {
        return Err(AppError::Invalid("text is empty".into()));
    }
    let mut bytes: Vec<u8> = Vec::new();
    for part in &parts {
        let piece = match p.adapter.as_str() {
            "google_tts" => google_synth(key, req, part).await?,
            "openai_tts" => openai_synth(p, key, req, part).await?,
            other => return Err(AppError::Invalid(format!("unknown adapter {other}"))),
        };
        bytes.extend_from_slice(&piece);
        if bytes.len() > MAX_AUDIO_BYTES {
            return Err(AppError::Invalid("generated audio is too large".into()));
        }
    }
    Ok(AudioOut {
        bytes,
        ext: "mp3",
        chunks: parts.len(),
    })
}

async fn google_synth(
    key: Option<&str>,
    req: &TtsRequest,
    text: &str,
) -> Result<Vec<u8>, AppError> {
    let lang = req
        .lang
        .clone()
        .filter(|l| !l.is_empty())
        .or_else(|| {
            // voice names look like "bn-IN-Standard-A"
            let mut it = req.voice_id.splitn(3, '-');
            match (it.next(), it.next(), it.next()) {
                (Some(a), Some(b), Some(_)) if a.len() == 2 => Some(format!("{a}-{b}")),
                _ => None,
            }
        })
        .ok_or_else(|| AppError::Invalid("a language code is required".into()))?;
    let mut voice = json!({ "languageCode": lang, "name": req.voice_id });
    let gemini_model = req.model.as_deref().filter(|m| !m.trim().is_empty());
    let mut audio = json!({ "audioEncoding": "MP3" });
    if let Some(m) = gemini_model {
        // Gemini-TTS models do not take rate/pitch tuning here.
        voice["modelName"] = json!(m);
    } else {
        audio["speakingRate"] = json!(req.speed.clamp(0.25, 4.0));
        audio["pitch"] = json!(req.pitch.clamp(-20.0, 20.0));
    }
    let body = json!({ "input": { "text": text }, "voice": voice, "audioConfig": audio });
    let resp = client()
        .post(format!("{GOOGLE_BASE}/text:synthesize"))
        .header("x-goog-api-key", google_key(key)?)
        .json(&body)
        .send()
        .await
        .map_err(map_send_error)?;
    let v = read_json(check(resp).await?).await?;
    let b64 = v
        .get("audioContent")
        .and_then(|a| a.as_str())
        .ok_or_else(|| AppError::BadResponse("no audio in the response".into()))?;
    STANDARD
        .decode(b64)
        .map_err(|e| AppError::BadResponse(e.to_string()))
}

async fn openai_synth(
    p: &ProviderRecord,
    key: Option<&str>,
    req: &TtsRequest,
    text: &str,
) -> Result<Vec<u8>, AppError> {
    let model = req
        .model
        .as_deref()
        .filter(|m| !m.trim().is_empty())
        .ok_or(AppError::NoModel)?;
    let body = json!({
        "model": model, "input": text, "voice": req.voice_id,
        "response_format": "mp3", "speed": req.speed.clamp(0.25, 4.0)
    });
    let mut rb = client()
        .post(format!("{}/audio/speech", openai_compat::base(p)?))
        .json(&body);
    if let Some(k) = key {
        rb = rb.bearer_auth(k);
    }
    let resp = check(rb.send().await.map_err(map_send_error)?).await?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::BadResponse(e.to_string()))?;
    if bytes.is_empty() {
        return Err(AppError::BadResponse("the server returned no audio".into()));
    }
    Ok(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_respect_limit_and_keep_text() {
        let text = "আমি বাংলায় গান গাই। ".repeat(300);
        let chunks = chunk_text(&text, 500);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|c| c.len() <= 500));
        let joined: String = chunks.join(" ");
        assert_eq!(joined.matches("গান").count(), 300);
    }

    #[test]
    fn long_sentence_without_punctuation_is_cut_safely() {
        let text = "অ".repeat(1000);
        let chunks = chunk_text(&text, 100);
        assert!(chunks.iter().all(|c| c.len() <= 100 && !c.is_empty()));
        assert_eq!(chunks.concat().chars().count(), 1000);
    }

    #[test]
    fn empty_text_has_no_chunks() {
        assert!(chunk_text("  \n ", 100).is_empty());
    }

    #[test]
    fn parses_google_voice_list() {
        let v = json!({"voices":[
            {"name":"bn-IN-Standard-A","languageCodes":["bn-IN"],"ssmlGender":"FEMALE"},
            {"name":"Kore","languageCodes":["bn-BD"],"ssmlGender":"SSML_VOICE_GENDER_UNSPECIFIED"}]});
        let out = parse_google_voices(&v);
        assert_eq!(out.len(), 2);
        assert_eq!(out[1].name, "bn-IN-Standard-A");
        assert_eq!(out[1].gender.as_deref(), Some("female"));
        assert_eq!(out[0].gender, None);
    }
}
