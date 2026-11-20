use std::time::Instant;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::providers::load_provider;
use crate::db::Db;
use crate::error::AppError;
use crate::providers::image_gen::{generate_image, ImageRequest, ReferenceImage};
use crate::providers::saved_model;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInput {
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub prompt: String,
    pub size: Option<String>,
    pub aspect: Option<String>,
    #[serde(default)]
    pub references: Vec<ReferenceImage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageOutput {
    pub data_b64: String,
    pub mime: String,
    pub provider_name: String,
    pub model: String,
}

#[tauri::command]
pub async fn ai_generate_image(
    db: State<'_, Db>,
    input: ImageInput,
) -> Result<ImageOutput, AppError> {
    if input.prompt.trim().is_empty() {
        return Err(AppError::Invalid("prompt is empty".into()));
    }
    let (record, model) = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        let default: Option<(Option<String>, Option<String>)> = conn
            .query_row(
                "SELECT provider_id, model FROM provider_defaults WHERE category = 'image'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (default_id, default_model) = default.unwrap_or((None, None));
        let id = input
            .provider_id
            .clone()
            .filter(|s| !s.is_empty())
            .or_else(|| default_id.clone())
            .ok_or(AppError::NoProvider)?;
        let rec = load_provider(&conn, &id)?;
        if rec.category != "image" || !rec.enabled {
            return Err(AppError::Invalid("provider cannot generate images".into()));
        }
        let model = input
            .model
            .clone()
            .filter(|m| !m.trim().is_empty())
            .or_else(|| saved_model(&rec))
            .or_else(|| {
                if default_id.as_deref() == Some(id.as_str()) {
                    default_model
                } else {
                    None
                }
            })
            .ok_or(AppError::NoModel)?;
        (rec, model)
    };
    let started = Instant::now();
    let req = ImageRequest {
        model: model.clone(),
        prompt: input.prompt,
        size: input.size,
        aspect: input.aspect,
        references: input.references,
    };
    let result = crate::keypool::with_keys(&db, &record, |key| {
        let (record, req) = (&record, &req);
        async move { generate_image(record, key.as_deref(), req).await }
    })
    .await;

    if let Ok(conn) = db.0.lock() {
        let (status, code) = match &result {
            Ok(_) => ("ok", None),
            Err(e) => ("error", Some(e.code())),
        };
        let _ = conn.execute(
            "INSERT INTO generation_log (category, provider_id, model, status, error_code, duration_ms, created_at)
             VALUES ('image', ?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![record.id, model, status, code, started.elapsed().as_millis() as i64],
        );
    }

    let out = result?;
    Ok(ImageOutput {
        data_b64: out.data_b64,
        mime: out.mime,
        provider_name: record.display_name,
        model,
    })
}
