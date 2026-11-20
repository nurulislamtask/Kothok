//! Voice Studio / Voice Library commands: synthesis, history, favourites, voice profiles.

use std::time::Instant;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::providers::load_provider;
use crate::db::Db;
use crate::error::AppError;
use crate::paths::{clean_ext, random_stem, AppPaths};
use crate::providers::saved_model;
use crate::providers::tts::{self, TtsRequest, VoiceInfo};

const MAX_TEXT_CHARS: usize = 100_000;

fn tts_provider(db: &Db, id: &str) -> Result<crate::providers::ProviderRecord, AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let rec = load_provider(&conn, id)?;
    if !matches!(rec.category.as_str(), "tts" | "clone") || !rec.enabled {
        return Err(AppError::Invalid("provider cannot generate speech".into()));
    }
    Ok(rec)
}

#[tauri::command]
pub async fn tts_list_voices(
    db: State<'_, Db>,
    provider_id: String,
    lang: Option<String>,
) -> Result<Vec<VoiceInfo>, AppError> {
    let rec = tts_provider(&db, &provider_id)?;
    if rec.adapter == "elevenlabs_clone" {
        // Cloned voices are the user's own profiles that were cloned on this provider.
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        let mut stmt = conn.prepare(
            "SELECT remote_voice_id, name, lang FROM voice_profiles
             WHERE remote_provider_id = ?1 AND remote_voice_id IS NOT NULL ORDER BY name",
        )?;
        let rows = stmt.query_map([&rec.id], |r| {
            Ok(VoiceInfo {
                id: r.get(0)?,
                name: r.get(1)?,
                language_codes: r.get::<_, Option<String>>(2)?.into_iter().collect(),
                gender: None,
            })
        })?;
        return rows.collect::<Result<Vec<_>, _>>().map_err(Into::into);
    }
    let key = crate::providers::key_for(&rec)?;
    tts::list_voices(&rec, key.as_deref(), lang.as_deref()).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthInput {
    pub provider_id: String,
    pub voice_id: String,
    pub lang: Option<String>,
    pub model: Option<String>,
    pub text: String,
    pub speed: Option<f32>,
    pub pitch: Option<f32>,
    /// Delivery / emotion instruction (Gemini only), applied to every chunk of the text.
    pub style: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthOutput {
    pub history_id: i64,
    pub file: String,
    pub provider_name: String,
    pub chunks: usize,
}

#[tauri::command]
pub async fn tts_synthesize(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    input: SynthInput,
) -> Result<SynthOutput, AppError> {
    if input.text.trim().is_empty() {
        return Err(AppError::Invalid("text is empty".into()));
    }
    if input.text.chars().count() > MAX_TEXT_CHARS {
        return Err(AppError::Invalid("text is too long".into()));
    }
    if input.voice_id.trim().is_empty() {
        return Err(AppError::Invalid("choose a voice first".into()));
    }
    let rec = tts_provider(&db, &input.provider_id)?;
    let model = input
        .model
        .clone()
        .filter(|m| !m.trim().is_empty())
        .or_else(|| saved_model(&rec));
    let req = TtsRequest {
        voice_id: input.voice_id.trim().to_string(),
        lang: input.lang.clone(),
        model: model.clone(),
        text: input.text.clone(),
        speed: input.speed.unwrap_or(1.0),
        pitch: input.pitch.unwrap_or(0.0),
        style: input.style.clone(),
    };

    let started = Instant::now();
    let result = crate::keypool::with_keys(&db, &rec, |key| {
        let (rec, req) = (&rec, &req);
        async move { tts::synthesize(rec, key.as_deref(), req).await }
    })
    .await;
    if let Ok(conn) = db.0.lock() {
        let (status, code) = match &result {
            Ok(_) => ("ok", None),
            Err(e) => ("error", Some(e.code())),
        };
        let _ = conn.execute(
            "INSERT INTO generation_log (category, provider_id, model, status, error_code, duration_ms, created_at)
             VALUES ('tts', ?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![rec.id, model, status, code, started.elapsed().as_millis() as i64],
        );
    }
    let audio = result?;

    let file = format!("{}.{}", random_stem(), clean_ext(audio.ext)?);
    std::fs::write(paths.media_path(&file)?, &audio.bytes)?;
    let preview: String = input.text.trim().chars().take(120).collect();
    let params_json = serde_json::json!({
        "speed": req.speed, "pitch": req.pitch, "model": model, "chunks": audio.chunks
    })
    .to_string();
    let history_id = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        conn.execute(
            "INSERT INTO tts_history (provider_id, voice_id, lang, text_preview, audio_path, params_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![rec.id, req.voice_id, input.lang, preview, file, params_json],
        )?;
        conn.last_insert_rowid()
    };
    Ok(SynthOutput {
        history_id,
        file,
        provider_name: rec.display_name,
        chunks: audio.chunks,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: i64,
    pub provider_id: Option<String>,
    pub voice_id: Option<String>,
    pub lang: Option<String>,
    pub text_preview: Option<String>,
    pub audio_path: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn tts_history_list(db: State<'_, Db>) -> Result<Vec<HistoryItem>, AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let mut stmt = conn.prepare(
        "SELECT id, provider_id, voice_id, lang, text_preview, audio_path, created_at
         FROM tts_history ORDER BY id DESC LIMIT 100",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(HistoryItem {
            id: r.get(0)?,
            provider_id: r.get(1)?,
            voice_id: r.get(2)?,
            lang: r.get(3)?,
            text_preview: r.get(4)?,
            audio_path: r.get(5)?,
            created_at: r.get(6)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

#[tauri::command]
pub fn tts_history_delete(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    id: i64,
) -> Result<(), AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let file: Option<String> = conn
        .query_row(
            "SELECT audio_path FROM tts_history WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    conn.execute("DELETE FROM tts_history WHERE id = ?1", [id])?;
    // Only remove the file if no saved project asset points at the same audio.
    if let Some(f) = file {
        let used: i64 = conn.query_row(
            "SELECT COUNT(*) FROM assets WHERE file_path = ?1",
            [&f],
            |r| r.get(0),
        )?;
        if used == 0 {
            if let Ok(p) = paths.media_path(&f) {
                let _ = std::fs::remove_file(p);
            }
        }
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub provider_id: String,
    pub voice_id: String,
}

#[tauri::command]
pub fn voice_favorites(db: State<'_, Db>) -> Result<Vec<Favorite>, AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let mut stmt = conn.prepare("SELECT provider_id, voice_id FROM voice_favorites")?;
    let rows = stmt.query_map([], |r| {
        Ok(Favorite {
            provider_id: r.get(0)?,
            voice_id: r.get(1)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

#[tauri::command]
pub fn voice_favorite_set(
    db: State<'_, Db>,
    provider_id: String,
    voice_id: String,
    favorite: bool,
) -> Result<(), AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    if favorite {
        conn.execute(
            "INSERT OR IGNORE INTO voice_favorites (provider_id, voice_id) VALUES (?1, ?2)",
            params![provider_id, voice_id],
        )?;
    } else {
        conn.execute(
            "DELETE FROM voice_favorites WHERE provider_id = ?1 AND voice_id = ?2",
            params![provider_id, voice_id],
        )?;
    }
    Ok(())
}

// ---- Voice profiles (consent-gated samples) ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceProfile {
    pub id: i64,
    pub name: String,
    pub engine: String,
    pub sample_path: String,
    pub lang: Option<String>,
    pub consent_confirmed_at: String,
    pub consent_statement: String,
    pub remote_voice_id: Option<String>,
    pub remote_provider_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    pub name: String,
    pub lang: Option<String>,
    /// File name previously returned by `save_media`.
    pub sample_file: String,
    pub consent_confirmed: bool,
    pub consent_statement: String,
}

const SAMPLE_EXTS: &[&str] = &["wav", "mp3", "m4a", "flac", "ogg"];

#[tauri::command]
pub fn voice_profile_create(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    input: ProfileInput,
) -> Result<VoiceProfile, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("profile name is required".into()));
    }
    if !input.consent_confirmed || input.consent_statement.trim().chars().count() < 10 {
        return Err(AppError::Invalid(
            "consent must be confirmed with a written statement".into(),
        ));
    }
    let p = paths.media_path(&input.sample_file)?;
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !SAMPLE_EXTS.contains(&ext.as_str()) {
        return Err(AppError::Invalid("sample must be an audio file".into()));
    }
    let len = std::fs::metadata(&p)?.len();
    if len < 10_000 {
        return Err(AppError::Invalid("the voice sample is too short".into()));
    }
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    conn.execute(
        "INSERT INTO voice_profiles (name, engine, sample_path, lang, consent_confirmed_at, consent_statement, created_at)
         VALUES (?1, 'unassigned', ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?4, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        params![name, input.sample_file, input.lang, input.consent_statement.trim()],
    )?;
    let id = conn.last_insert_rowid();
    load_profile(&conn, id)
}

fn load_profile(conn: &rusqlite::Connection, id: i64) -> Result<VoiceProfile, AppError> {
    conn.query_row(
        "SELECT id, name, engine, sample_path, lang, consent_confirmed_at, consent_statement,
                remote_voice_id, remote_provider_id
         FROM voice_profiles WHERE id = ?1",
        [id],
        map_profile,
    )
    .map_err(Into::into)
}

fn map_profile(r: &rusqlite::Row<'_>) -> rusqlite::Result<VoiceProfile> {
    Ok(VoiceProfile {
        id: r.get(0)?,
        name: r.get(1)?,
        engine: r.get(2)?,
        sample_path: r.get(3)?,
        lang: r.get(4)?,
        consent_confirmed_at: r.get(5)?,
        consent_statement: r.get(6)?,
        remote_voice_id: r.get(7)?,
        remote_provider_id: r.get(8)?,
    })
}

#[tauri::command]
pub fn voice_profile_list(db: State<'_, Db>) -> Result<Vec<VoiceProfile>, AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let mut stmt = conn.prepare(
        "SELECT id, name, engine, sample_path, lang, consent_confirmed_at, consent_statement,
                remote_voice_id, remote_provider_id
         FROM voice_profiles ORDER BY id DESC",
    )?;
    let rows = stmt.query_map([], map_profile)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

#[tauri::command]
pub async fn voice_profile_delete(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    id: i64,
) -> Result<(), AppError> {
    let (sample, remote_voice, remote_provider) = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        conn.query_row(
            "SELECT sample_path, remote_voice_id, remote_provider_id FROM voice_profiles WHERE id = ?1",
            [id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?)),
        )
        .map_err(AppError::from)?
    };
    // Remove the cloned voice from the service too (best effort: the local profile goes either way).
    if let (Some(voice), Some(pid)) = (remote_voice, remote_provider) {
        let rec = {
            let conn = db.0.lock().map_err(|_| AppError::Lock)?;
            load_provider(&conn, &pid).ok()
        };
        if let Some(rec) = rec {
            if let Ok(key) = crate::providers::key_for(&rec) {
                let _ = crate::providers::elevenlabs::delete_voice(key.as_deref(), &voice).await;
            }
        }
    }
    {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        conn.execute("DELETE FROM voice_profiles WHERE id = ?1", [id])?;
    }
    if let Ok(p) = paths.media_path(&sample) {
        let _ = std::fs::remove_file(p);
    }
    Ok(())
}

/// Upload the consented sample to a cloning provider and keep the resulting voice id.
#[tauri::command]
pub async fn voice_profile_clone(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    profile_id: i64,
    provider_id: String,
) -> Result<VoiceProfile, AppError> {
    let rec = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        load_provider(&conn, &provider_id)?
    };
    if rec.category != "clone" || !rec.enabled {
        return Err(AppError::Invalid("provider cannot clone voices".into()));
    }
    let profile = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        load_profile(&conn, profile_id)?
    };
    if profile.consent_statement.trim().chars().count() < 10 {
        return Err(AppError::Invalid(
            "consent is missing for this profile".into(),
        ));
    }
    if profile.remote_voice_id.is_some() {
        return Err(AppError::Invalid("this profile is already cloned".into()));
    }
    let path = paths.media_path(&profile.sample_path)?;
    let size = std::fs::metadata(&path)?.len();
    if size > 10 * 1024 * 1024 {
        return Err(AppError::Invalid(
            "the voice sample must be 10 MB or smaller".into(),
        ));
    }
    let bytes = std::fs::read(&path)?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("mp3");
    let key = crate::providers::key_for(&rec)?;
    let voice_id = crate::providers::elevenlabs::create_voice(
        key.as_deref(),
        &profile.name,
        &format!("sample.{ext}"),
        super::files::mime_for(ext),
        bytes,
    )
    .await?;
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    conn.execute(
        "UPDATE voice_profiles SET engine = 'elevenlabs', remote_voice_id = ?1, remote_provider_id = ?2 WHERE id = ?3",
        params![voice_id, rec.id, profile_id],
    )?;
    load_profile(&conn, profile_id)
}
