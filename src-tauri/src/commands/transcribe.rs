use std::time::Instant;

use rusqlite::params;
use serde::Deserialize;
use tauri::State;

use super::files::mime_for;
use super::providers::load_provider;
use super::tools;
use crate::db::Db;
use crate::error::AppError;
use crate::paths::AppPaths;
use crate::providers::saved_model;
use crate::providers::stt::{self, SttOutput, SttSegment};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeInput {
    pub provider_id: Option<String>,
    pub model: Option<String>,
    /// ISO-639-1 code such as "bn"; empty means auto-detect.
    pub lang: Option<String>,
    /// File name returned by `save_media`.
    pub file: String,
    /// Ask the service to label who is speaking (Gemini 3.5 Transcribe only).
    #[serde(default)]
    pub diarize: bool,
}

#[tauri::command]
pub async fn stt_transcribe(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    input: TranscribeInput,
) -> Result<SttOutput, AppError> {
    let path = paths.media_path(&input.file)?;
    let size = std::fs::metadata(&path)?.len() as usize;
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
    let is_local = record.adapter == "whisper_local";
    let limit = if record.adapter == "gemini_stt"
        && crate::providers::gemini_media::is_transcribe_model(&model)
    {
        // Uploaded with the Files API, so the inline limit does not apply.
        500 * 1024 * 1024
    } else if record.adapter == "gemini_stt" {
        crate::providers::gemini_media::MAX_INLINE_AUDIO_BYTES
    } else {
        stt::MAX_UPLOAD_BYTES
    };
    let ffmpeg = if is_local || size > limit {
        Some(
            tools::ffmpeg_path(&paths)
                .ok_or_else(|| {
                    AppError::Invalid(
                        "FFmpeg is needed for this audio; install it in Settings → Tools".into(),
                    )
                })?
                .0,
        )
    } else {
        None
    };
    let started = Instant::now();
    let result = if is_local {
        let (pp, ff, mm, ll) = (
            paths.inner().clone(),
            ffmpeg.clone().unwrap_or_default(),
            model.clone(),
            input.lang.clone(),
        );
        let src = path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            tools::whisper_transcribe(&pp, &ff, &mm, ll.as_deref(), &src)
        })
        .await
        .map_err(|e| AppError::Invalid(e.to_string()))
        .and_then(|r| r)
    } else if let Some(ff) = ffmpeg {
        crate::keypool::with_keys(&db, &record, |key| {
            let (record, model, lang, ff, path, paths) =
                (&record, &model, input.lang.as_deref(), &ff, &path, &paths);
            async move {
                transcribe_large(
                    record,
                    key.as_deref(),
                    model,
                    lang,
                    ff,
                    path,
                    paths,
                    input.diarize,
                )
                .await
            }
        })
        .await
    } else {
        let bytes = std::fs::read(&path)?;
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_string();
        crate::keypool::with_keys(&db, &record, |key| {
            let (record, model, lang, bytes, ext) =
                (&record, &model, input.lang.as_deref(), &bytes, &ext);
            async move {
                stt::transcribe(
                    record,
                    key.as_deref(),
                    model,
                    lang,
                    &format!("audio.{ext}"),
                    mime_for(ext),
                    bytes.clone(),
                    input.diarize,
                )
                .await
            }
        })
        .await
    };
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

/// Shrink/split with FFmpeg, transcribe each piece, then stitch the timestamps back together.
async fn transcribe_large(
    record: &crate::providers::ProviderRecord,
    key: Option<&str>,
    model: &str,
    lang: Option<&str>,
    ffmpeg: &std::path::Path,
    input: &std::path::Path,
    paths: &AppPaths,
    diarize: bool,
) -> Result<SttOutput, AppError> {
    let limit = if record.adapter == "gemini_stt" {
        crate::providers::gemini_media::MAX_INLINE_AUDIO_BYTES as u64
    } else {
        stt::MAX_UPLOAD_BYTES as u64
    } - 1024 * 1024;
    let work = paths
        .temp
        .join(format!("stt-{}", crate::paths::random_stem()));
    std::fs::create_dir_all(&work)?;
    let (ff, inp, wd) = (ffmpeg.to_path_buf(), input.to_path_buf(), work.clone());
    let pieces =
        tauri::async_runtime::spawn_blocking(move || tools::prepare_audio(&ff, &inp, &wd, limit))
            .await
            .map_err(|e| AppError::Invalid(e.to_string()))
            .and_then(|r| r);
    let pieces = match pieces {
        Ok(p) => p,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&work);
            return Err(e);
        }
    };
    let mut texts = Vec::new();
    let mut segments: Vec<SttSegment> = Vec::new();
    let mut language = None;
    let mut has_timing = true;
    let mut failure = None;
    for (file, offset) in pieces {
        let step = async {
            let bytes = std::fs::read(&file)?;
            stt::transcribe(
                record,
                key,
                model,
                lang,
                "audio.mp3",
                "audio/mpeg",
                bytes,
                diarize,
            )
            .await
        }
        .await;
        match step {
            Ok(out) => {
                language = language.or(out.language);
                has_timing &= out.has_timing;
                texts.push(out.text);
                segments.extend(out.segments.into_iter().map(|s| SttSegment {
                    start_ms: s.start_ms + offset,
                    end_ms: s.end_ms + offset,
                    text: s.text,
                    speaker: s.speaker,
                }));
            }
            Err(e) => {
                failure = Some(e);
                break;
            }
        }
    }
    let _ = std::fs::remove_dir_all(&work);
    if let Some(e) = failure {
        return Err(e);
    }
    Ok(SttOutput {
        text: texts.join(" "),
        language,
        segments,
        has_timing,
    })
}
