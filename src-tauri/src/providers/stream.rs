//! Streaming text generation (server-sent events) for the OpenAI-style and Gemini adapters.

use serde_json::{json, Value};

use super::http::{check, client, map_send_error};
use super::{gemini, openai_compat, ProviderRecord, TextRequest};
use crate::error::AppError;

/// Receives text as it is generated.
pub type OnChunk<'a> = &'a mut (dyn FnMut(&str) + Send);

/// Splits a byte stream into server-sent-event `data:` payloads, tolerating chunk boundaries
/// that fall inside a line or inside a multi-byte character.
#[derive(Default)]
pub struct SseBuffer {
    buf: Vec<u8>,
}

impl SseBuffer {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        while let Some(pos) = self.buf.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line);
            let line = line.trim_end_matches(['\r', '\n']);
            if let Some(rest) = line.strip_prefix("data:") {
                let p = rest.trim();
                if !p.is_empty() {
                    out.push(p.to_string());
                }
            }
        }
        out
    }
}

pub async fn openai_stream(
    p: &ProviderRecord,
    key: Option<&str>,
    req: &TextRequest,
    on_chunk: OnChunk<'_>,
) -> Result<String, AppError> {
    let mut messages = Vec::new();
    if let Some(s) = &req.system {
        messages.push(json!({ "role": "system", "content": s }));
    }
    messages.push(json!({ "role": "user", "content": req.prompt }));
    let mut body = json!({ "model": req.model, "messages": messages, "stream": true });
    if let Some(t) = req.temperature {
        body["temperature"] = json!(t);
    }
    if let Some(m) = req.max_tokens {
        body["max_tokens"] = json!(m);
    }
    let mut rb = client()
        .post(format!("{}/chat/completions", openai_compat::base(p)?))
        .timeout(std::time::Duration::from_secs(900))
        .json(&body);
    if let Some(k) = key {
        rb = rb.bearer_auth(k);
    }
    let mut resp = check(rb.send().await.map_err(map_send_error)?).await?;
    let mut sse = SseBuffer::default();
    let mut text = String::new();
    'outer: while let Some(chunk) = resp.chunk().await.map_err(map_send_error)? {
        for payload in sse.push(&chunk) {
            if payload == "[DONE]" {
                break 'outer;
            }
            let Ok(v) = serde_json::from_str::<Value>(&payload) else {
                continue;
            };
            if let Some(err) = v.get("error") {
                let msg = err
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("stream error");
                return Err(AppError::Provider(msg.to_string()));
            }
            if let Some(d) = v
                .pointer("/choices/0/delta/content")
                .and_then(|c| c.as_str())
            {
                if !d.is_empty() {
                    text.push_str(d);
                    on_chunk(d);
                }
            }
        }
    }
    if text.trim().is_empty() {
        return Err(AppError::EmptyReply);
    }
    Ok(text)
}

pub async fn gemini_stream(
    p: &ProviderRecord,
    key: Option<&str>,
    req: &TextRequest,
    on_chunk: OnChunk<'_>,
) -> Result<String, AppError> {
    let key = key.ok_or(AppError::InvalidKey)?;
    if !gemini::valid_model_name(&req.model) {
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
            "{}/v1beta/models/{}:streamGenerateContent?alt=sse",
            gemini::base(p)?,
            req.model
        ))
        .header("x-goog-api-key", key)
        .timeout(std::time::Duration::from_secs(900))
        .json(&body)
        .send()
        .await
        .map_err(map_send_error)?;
    let mut resp = check(resp).await?;
    let mut sse = SseBuffer::default();
    let mut text = String::new();
    let mut reason = String::from("unknown");
    while let Some(chunk) = resp.chunk().await.map_err(map_send_error)? {
        for payload in sse.push(&chunk) {
            let Ok(v) = serde_json::from_str::<Value>(&payload) else {
                continue;
            };
            if let Some(r) = v
                .pointer("/promptFeedback/blockReason")
                .or_else(|| v.pointer("/candidates/0/finishReason"))
                .and_then(|r| r.as_str())
            {
                reason = r.to_string();
            }
            if let Some(parts) = v
                .pointer("/candidates/0/content/parts")
                .and_then(|p| p.as_array())
            {
                for part in parts {
                    if part.get("thought").and_then(|t| t.as_bool()) == Some(true) {
                        continue;
                    }
                    if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                        if !t.is_empty() {
                            text.push_str(t);
                            on_chunk(t);
                        }
                    }
                }
            }
        }
    }
    if text.trim().is_empty() {
        return Err(AppError::Provider(format!(
            "empty response (reason: {reason})"
        )));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_events_across_chunks() {
        let mut b = SseBuffer::default();
        assert!(b.push(b"data: {\"a\":1}\n\nda").len() == 1);
        let out = b.push(b"ta: [DONE]\n\n");
        assert_eq!(out, vec!["[DONE]".to_string()]);
    }

    #[test]
    fn keeps_split_multibyte_characters_intact() {
        let line = "data: আমি\n".as_bytes().to_vec();
        let (a, c) = line.split_at(8); // inside the first Bengali character
        let mut b = SseBuffer::default();
        assert!(b.push(a).is_empty());
        assert_eq!(b.push(c), vec!["আমি".to_string()]);
    }

    #[test]
    fn ignores_comments_and_crlf() {
        let mut b = SseBuffer::default();
        assert_eq!(
            b.push(b": keep-alive\r\ndata: {\"x\":2}\r\n\r\n"),
            vec!["{\"x\":2}".to_string()]
        );
    }
}
