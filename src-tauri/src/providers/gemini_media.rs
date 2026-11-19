//! Gemini API speech: text-to-speech (`responseModalities: AUDIO`) and audio transcription
//! (audio sent inline to `generateContent`). Uses the same Gemini API key as text generation.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

use super::http::{check, client, map_send_error, read_json};
use super::stt::SttOutput;
use super::tts::VoiceInfo;
use super::ProviderRecord;
use crate::error::AppError;

const DEFAULT_BASE: &str = "https://generativelanguage.googleapis.com";

/// Largest audio sent inline; requests are capped near 20 MB including base64 overhead.
pub const MAX_INLINE_AUDIO_BYTES: usize = 14 * 1024 * 1024;

/// Prebuilt Gemini-TTS voices listed in Google's speech-generation documentation.
pub const GEMINI_VOICES: &[&str] = &[
    "Zephyr",
    "Puck",
    "Charon",
    "Kore",
    "Fenrir",
    "Leda",
    "Orus",
    "Aoede",
    "Callirrhoe",
    "Autonoe",
    "Enceladus",
    "Iapetus",
    "Umbriel",
    "Algieba",
    "Despina",
    "Erinome",
    "Algenib",
    "Rasalgethi",
    "Laomedeia",
    "Achernar",
    "Alnilam",
    "Schedar",
    "Gacrux",
    "Pulcherrima",
    "Achird",
    "Zubenelgenubi",
    "Vindemiatrix",
    "Sadachbia",
    "Sadaltager",
    "Sulafat",
];

pub fn voices() -> Vec<VoiceInfo> {
    GEMINI_VOICES
        .iter()
        .map(|n| VoiceInfo {
            id: (*n).to_string(),
            name: (*n).to_string(),
            // Gemini-TTS detects the language from the text itself.
            language_codes: vec![],
            gender: None,
        })
        .collect()
}

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

fn model_ok(m: &str) -> bool {
    !m.is_empty()
        && m.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_'))
}

async fn generate(
    p: &ProviderRecord,
    key: &str,
    model: &str,
    body: Value,
) -> Result<Value, AppError> {
    if !model_ok(model) {
        return Err(AppError::Invalid("invalid model name".into()));
    }
    let resp = client()
        .post(format!(
            "{}/v1beta/models/{model}:generateContent",
            base(p)?
        ))
        .header("x-goog-api-key", key)
        .timeout(std::time::Duration::from_secs(600))
        .json(&body)
        .send()
        .await
        .map_err(map_send_error)?;
    read_json(check(resp).await?).await
}

/// Returns 16-bit mono PCM and its sample rate.
pub async fn synthesize_pcm(
    p: &ProviderRecord,
    key: Option<&str>,
    model: &str,
    voice: &str,
    text: &str,
) -> Result<(Vec<u8>, u32), AppError> {
    let key = key.ok_or(AppError::InvalidKey)?;
    let body = json!({
        "contents": [{ "parts": [{ "text": text }] }],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": { "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": voice } } }
        }
    });
    let v = generate(p, key, model, body).await?;
    parse_audio(&v)
}

pub fn parse_audio(v: &Value) -> Result<(Vec<u8>, u32), AppError> {
    let part = v
        .pointer("/candidates/0/content/parts")
        .and_then(|p| p.as_array())
        .and_then(|parts| parts.iter().find(|x| x.get("inlineData").is_some()))
        .ok_or_else(|| {
            AppError::BadResponse(
                "the model returned no audio (is this a text-to-speech model?)".into(),
            )
        })?;
    let data = part
        .pointer("/inlineData/data")
        .and_then(|d| d.as_str())
        .ok_or_else(|| AppError::BadResponse("no audio data".into()))?;
    let mime = part
        .pointer("/inlineData/mimeType")
        .and_then(|m| m.as_str())
        .unwrap_or("");
    let rate = mime
        .split(';')
        .find_map(|s| s.trim().strip_prefix("rate="))
        .and_then(|r| r.parse().ok())
        .unwrap_or(24_000);
    let pcm = STANDARD
        .decode(data)
        .map_err(|e| AppError::BadResponse(e.to_string()))?;
    Ok((pcm, rate))
}

/// Wrap raw 16-bit mono PCM in a WAV container.
pub fn wav_from_pcm(pcm: &[u8], rate: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(pcm.len() + 44);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    out.extend_from_slice(pcm);
    out
}

fn language_name(code: &str) -> &'static str {
    match code.get(..2).unwrap_or("") {
        "bn" => "Bengali (Bangla)",
        "en" => "English",
        "hi" => "Hindi",
        "ur" => "Urdu",
        "ar" => "Arabic",
        _ => "its original language",
    }
}

pub async fn transcribe(
    p: &ProviderRecord,
    key: Option<&str>,
    model: &str,
    lang: Option<&str>,
    mime: &str,
    bytes: &[u8],
) -> Result<SttOutput, AppError> {
    let key = key.ok_or(AppError::InvalidKey)?;
    if bytes.len() > MAX_INLINE_AUDIO_BYTES {
        return Err(AppError::Invalid(
            "audio is too large for Gemini; compress it with FFmpeg first".into(),
        ));
    }
    let language = lang
        .filter(|l| !l.is_empty())
        .map(language_name)
        .unwrap_or("its original language");
    let prompt = format!(
        "Transcribe this audio word for word in {language}. Write Bengali in Bengali script. \
         Output only the transcript text, with no timestamps, notes or commentary."
    );
    let body = json!({
        "contents": [{ "parts": [
            { "text": prompt },
            { "inlineData": { "mimeType": mime, "data": STANDARD.encode(bytes) } }
        ]}]
    });
    let v = generate(p, key, model, body).await?;
    let text: String = v
        .pointer("/candidates/0/content/parts")
        .and_then(|p| p.as_array())
        .map(|parts| {
            parts
                .iter()
                .filter_map(|x| x.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(AppError::BadResponse("no speech was recognised".into()));
    }
    Ok(SttOutput {
        text: text.clone(),
        language: lang.map(String::from).filter(|l| !l.is_empty()),
        segments: vec![super::stt::SttSegment {
            start_ms: 0,
            end_ms: 0,
            text,
        }],
        has_timing: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pcm_and_rate() {
        let v = json!({"candidates":[{"content":{"parts":[{"inlineData":{
            "mimeType":"audio/L16;codec=pcm;rate=24000","data":STANDARD.encode([1u8,2,3,4])}}]}}]});
        let (pcm, rate) = parse_audio(&v).unwrap();
        assert_eq!(pcm, vec![1, 2, 3, 4]);
        assert_eq!(rate, 24000);
    }

    #[test]
    fn text_only_reply_is_an_error() {
        let v = json!({"candidates":[{"content":{"parts":[{"text":"hi"}]}}]});
        assert!(parse_audio(&v).is_err());
    }

    #[test]
    fn wav_header_is_valid() {
        let w = wav_from_pcm(&[0u8; 100], 24000);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(w[4..8].try_into().unwrap()), 136);
        assert_eq!(&w[36..40], b"data");
        assert_eq!(w.len(), 144);
        assert_eq!(u32::from_le_bytes(w[24..28].try_into().unwrap()), 24000);
    }

    #[test]
    fn has_documented_voices() {
        assert_eq!(GEMINI_VOICES.len(), 30);
        assert!(voices().iter().any(|v| v.id == "Kore"));
    }
}
