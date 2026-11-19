use std::time::Instant;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use super::providers::load_provider;
use crate::db::Db;
use crate::error::AppError;
use crate::providers::{self, saved_model, ProviderRecord, TextRequest};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateInput {
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub system: Option<String>,
    pub prompt: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    /// Try configured fallback providers if the primary fails.
    #[serde(default)]
    pub allow_fallback: bool,
    /// Paid providers the user has explicitly confirmed for this request.
    #[serde(default)]
    pub allow_paid: Vec<String>,
    /// When set, text is streamed to the UI as `ai-chunk` events carrying this id.
    #[serde(default)]
    pub stream_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChunkEvent {
    stream_id: String,
    text: String,
    /// True when a new attempt (fallback provider) starts and earlier text must be discarded.
    reset: bool,
    provider_name: String,
    model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateOutput {
    pub text: String,
    pub provider_id: String,
    pub provider_name: String,
    pub model: String,
    pub fell_back: bool,
}

struct Candidate {
    record: ProviderRecord,
    model: String,
    key: Option<String>,
}

fn resolve(db: &Db, input: &GenerateInput) -> Result<Vec<Candidate>, AppError> {
    if input.prompt.trim().is_empty() {
        return Err(AppError::Invalid("prompt is empty".into()));
    }
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;

    let default: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT provider_id, model FROM provider_defaults WHERE category = 'text'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (default_id, default_model) = default.unwrap_or((None, None));

    let primary_id = input
        .provider_id
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| default_id.clone())
        .ok_or(AppError::NoProvider)?;
    let primary = load_provider(&conn, &primary_id)?;
    if !primary.enabled {
        return Err(AppError::Invalid("provider is disabled".into()));
    }
    let model = input
        .model
        .clone()
        .filter(|m| !m.trim().is_empty())
        .or_else(|| {
            if default_id.as_deref() == Some(primary_id.as_str()) {
                default_model.clone()
            } else {
                None
            }
        })
        .or_else(|| saved_model(&primary))
        .ok_or(AppError::NoModel)?;

    let key = crate::providers::key_for(&primary)?;
    let mut out = vec![Candidate {
        record: primary,
        model,
        key,
    }];

    if input.allow_fallback {
        let mut stmt = conn.prepare(
            "SELECT provider_id, model FROM fallback_chains WHERE category = 'text' ORDER BY position",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })?;
        let chain = rows.collect::<Result<Vec<_>, _>>()?;
        for (pid, chain_model) in chain {
            if pid == primary_id {
                continue;
            }
            let rec = match load_provider(&conn, &pid) {
                Ok(r) => r,
                Err(_) => continue,
            };
            if !rec.enabled || rec.category != "text" {
                continue;
            }
            let Some(model) = saved_model(&rec).or(chain_model) else {
                continue;
            };
            let key = crate::providers::key_for(&rec)?;
            out.push(Candidate {
                record: rec,
                model,
                key,
            });
        }
    }
    Ok(out)
}

fn log(db: &Db, c: &Candidate, status: &str, code: Option<&str>, ms: i64) {
    if let Ok(conn) = db.0.lock() {
        let _ = conn.execute(
            "INSERT INTO generation_log (category, provider_id, model, status, error_code, duration_ms, created_at)
             VALUES ('text', ?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![c.record.id, c.model, status, code, ms],
        );
    }
}

#[tauri::command]
pub async fn ai_generate(
    app: AppHandle,
    db: State<'_, Db>,
    input: GenerateInput,
) -> Result<GenerateOutput, AppError> {
    let candidates = resolve(&db, &input)?;

    let mut last_err: Option<AppError> = None;
    let mut needs_confirm: Option<String> = None;

    for (i, cand) in candidates.iter().enumerate() {
        // Never silently fall back to a provider that may charge money.
        if i > 0 && cand.record.cost_class == "paid" && !input.allow_paid.contains(&cand.record.id)
        {
            needs_confirm = Some(cand.record.id.clone());
            continue;
        }
        let started = Instant::now();
        let req = TextRequest {
            model: cand.model.clone(),
            system: input.system.clone(),
            prompt: input.prompt.clone(),
            temperature: input.temperature,
            max_tokens: input.max_tokens,
        };
        let result = if let Some(sid) = input.stream_id.clone() {
            let emit = |text: &str, reset: bool| {
                let _ = app.emit(
                    "ai-chunk",
                    ChunkEvent {
                        stream_id: sid.clone(),
                        text: text.to_string(),
                        reset,
                        provider_name: cand.record.display_name.clone(),
                        model: cand.model.clone(),
                    },
                );
            };
            emit("", true);
            let mut on_chunk = |t: &str| emit(t, false);
            providers::generate_text_stream(&cand.record, cand.key.as_deref(), &req, &mut on_chunk)
                .await
        } else {
            providers::generate_text(&cand.record, cand.key.as_deref(), &req).await
        };
        match result {
            Ok(text) => {
                log(&db, cand, "ok", None, started.elapsed().as_millis() as i64);
                return Ok(GenerateOutput {
                    text,
                    provider_id: cand.record.id.clone(),
                    provider_name: cand.record.display_name.clone(),
                    model: cand.model.clone(),
                    fell_back: i > 0,
                });
            }
            Err(e) => {
                log(
                    &db,
                    cand,
                    "error",
                    Some(e.code()),
                    started.elapsed().as_millis() as i64,
                );
                let can_try_next = matches!(
                    e,
                    AppError::InvalidKey
                        | AppError::Quota
                        | AppError::Network(_)
                        | AppError::Provider(_)
                        | AppError::BadResponse(_)
                        | AppError::EmptyReply
                );
                last_err = Some(e);
                if !can_try_next {
                    break;
                }
            }
        }
    }

    if let Some(id) = needs_confirm {
        return Err(AppError::NeedsConfirmation(id));
    }
    Err(last_err.unwrap_or(AppError::NoProvider))
}
