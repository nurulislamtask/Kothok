use std::time::Instant;

use rusqlite::params;
use serde::Deserialize;
use tauri::State;

use super::files::mime_for;
use super::providers::load_provider;
use crate::credentials;
use crate::db::Db;
use crate::error::AppError;
use crate::paths::AppPaths;
use crate::providers::saved_model;
use crate::providers::stt::{self, SttOutput};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeInput {
    pub provider_id: Option<String>,
    pub model: Option<String>,
    /// ISO-639-1 code such as "bn"; empty means auto-detect.
    pub lang: Option<String>,
    /// File name returned by `save_media`.
    pub file: String,
}

#[tauri::command]
pub async fn stt_transcribe(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    input: TranscribeInput,
) -> Result<SttOutput, AppError> {
    let path = paths.media_path(&input.file)?;
    let size = std::fs::metadata(&path)?.len() as usize;
    if size > stt::MAX_UPLOAD_BYTES {
        return Err(AppError::Invalid(
            "audio is larger than 25 MB; compress or split it first".into(),
        ));
    }
    let (record, model) = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        let id = match input.provider_id.clone().filter(|s| !s.is_empty()) {
            Some(id) => id,
            None => conn
                .query_row(
                    "SELECT provider_id FROM provider_defaults WHERE category = 'stt'",
                    [],
                    |r| r.get::<_, Option<String>>(0),
                )
                .ok()
                .flatten()
                .ok_or(AppError::NoProvider)?,
        };
        let rec = load_provider(&conn, &id)?;
        if rec.category != "stt" || !rec.enabled {
            return Err(AppError::Invalid("provider cannot transcribe".into()));
        }
        let model = input
            .model
            .clone()
            .filter(|m| !m.trim().is_empty())
            .or_else(|| saved_model(&rec))
            .ok_or(AppError::NoModel)?;
        (rec, model)
    };
    let key = credentials::get(&record.id)?;
    let bytes = std::fs::read(&path)?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let name = format!("audio.{ext}");

    let started = Instant::now();
    let result = stt::transcribe(
        &record,
        key.as_deref(),
        &model,
        input.lang.as_deref(),
        &name,
        mime_for(ext),
        bytes,
    )
    .await;
    if let Ok(conn) = db.0.lock() {
        let (status, code) = match &result {
            Ok(_) => ("ok", None),
            Err(e) => ("error", Some(e.code())),
        };
        let _ = conn.execute(
            "INSERT INTO generation_log (category, provider_id, model, status, error_code, duration_ms, created_at)
             VALUES ('stt', ?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![record.id, model, status, code, started.elapsed().as_millis() as i64],
        );
    }
    result
}
