use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::credentials;
use crate::db::Db;
use crate::error::AppError;
use crate::providers::{
    self, adapters_for, needs_endpoint, saved_model, validate_endpoint, ModelInfo, ProviderRecord,
    CATEGORIES, COST_CLASSES,
};

const COLS: &str = "id, category, adapter, display_name, endpoint, enabled, cost_class, \
                    settings_json, last_status, last_error, last_checked_at";

fn row_to_record(r: &rusqlite::Row<'_>) -> rusqlite::Result<ProviderRecord> {
    Ok(ProviderRecord {
        id: r.get(0)?,
        category: r.get(1)?,
        adapter: r.get(2)?,
        display_name: r.get(3)?,
        endpoint: r.get(4)?,
        enabled: r.get::<_, i64>(5)? != 0,
        cost_class: r.get(6)?,
        settings_json: r.get(7)?,
        last_status: r.get(8)?,
        last_error: r.get(9)?,
        last_checked_at: r.get(10)?,
    })
}

pub fn load_provider(conn: &Connection, id: &str) -> Result<ProviderRecord, AppError> {
    let rec = conn
        .query_row(
            &format!("SELECT {COLS} FROM providers WHERE id = ?1"),
            [id],
            row_to_record,
        )
        .optional()?;
    rec.ok_or(AppError::ProviderNotFound)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDto {
    #[serde(flatten)]
    pub record: ProviderRecord,
    pub has_key: bool,
}

fn to_dto(record: ProviderRecord) -> Result<ProviderDto, AppError> {
    let has_key = providers::key_for(&record)?.is_some();
    Ok(ProviderDto { record, has_key })
}

#[tauri::command]
pub fn list_providers(db: State<'_, Db>) -> Result<Vec<ProviderDto>, AppError> {
    let records = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLS} FROM providers ORDER BY category, display_name"
        ))?;
        let rows = stmt.query_map([], row_to_record)?;
        let collected = rows.collect::<Result<Vec<_>, _>>()?;
        collected
    };
    records.into_iter().map(to_dto).collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInput {
    pub id: Option<String>,
    pub category: String,
    pub adapter: String,
    pub display_name: String,
    pub endpoint: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub cost_class: String,
    pub settings_json: Option<String>,
    pub api_key: Option<String>,
}

fn default_true() -> bool {
    true
}

fn validate_input(input: &ProviderInput) -> Result<(), AppError> {
    if !CATEGORIES.contains(&input.category.as_str()) {
        return Err(AppError::Invalid("unknown category".into()));
    }
    if !adapters_for(&input.category).contains(&input.adapter.as_str()) {
        return Err(AppError::Invalid("unknown adapter".into()));
    }
    if !COST_CLASSES.contains(&input.cost_class.as_str()) {
        return Err(AppError::Invalid("unknown cost class".into()));
    }
    let name = input.display_name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(AppError::Invalid("name must be 1-80 characters".into()));
    }
    let endpoint = input
        .endpoint
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match endpoint {
        Some(e) => validate_endpoint(e)?,
        None if needs_endpoint(&input.adapter) => {
            return Err(AppError::Invalid("endpoint is required".into()))
        }
        None => {}
    }
    if let Some(s) = &input.settings_json {
        serde_json::from_str::<serde_json::Value>(s)
            .map_err(|_| AppError::Invalid("settings must be valid JSON".into()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn save_provider(db: State<'_, Db>, input: ProviderInput) -> Result<ProviderDto, AppError> {
    validate_input(&input)?;
    let endpoint = input
        .endpoint
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from);

    let record = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        let id = match input.id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(id) => id.to_string(),
            None => {
                let suffix: String =
                    conn.query_row("SELECT lower(hex(randomblob(4)))", [], |r| r.get(0))?;
                format!("{}-{}", input.adapter, suffix)
            }
        };
        conn.execute(
            "INSERT INTO providers (id, category, adapter, display_name, endpoint, enabled, cost_class, settings_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               category = excluded.category, adapter = excluded.adapter,
               display_name = excluded.display_name, endpoint = excluded.endpoint,
               enabled = excluded.enabled, cost_class = excluded.cost_class,
               settings_json = excluded.settings_json",
            params![
                id,
                input.category,
                input.adapter,
                input.display_name.trim(),
                endpoint,
                input.enabled as i64,
                input.cost_class,
                input.settings_json
            ],
        )?;
        load_provider(&conn, &id)?
    };

    if let Some(k) = input
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty())
    {
        credentials::set(&providers::key_owner(&record), k)?;
    }
    to_dto(record)
}

#[tauri::command]
pub fn delete_provider(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    let (own_key, linked): (bool, Vec<String>) = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        let rec = load_provider(&conn, &id).ok();
        let own_key = rec.map(|r| providers::key_owner(&r) == id).unwrap_or(true);
        // Providers that borrow this one's key go with it, otherwise they would be left keyless.
        let mut stmt = conn.prepare(
            "SELECT id FROM providers WHERE json_extract(settings_json, '$.keyFrom') = ?1",
        )?;
        let linked = stmt
            .query_map([&id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        for l in &linked {
            conn.execute("DELETE FROM providers WHERE id = ?1", [l])?;
        }
        conn.execute("DELETE FROM providers WHERE id = ?1", [&id])?;
        (own_key, linked)
    };
    let _ = linked;
    // A borrowed key belongs to its owner and stays.
    if own_key {
        if let Ok(conn) = db.0.lock() {
            crate::keypool::forget_owner(&conn, &id);
        }
        credentials::delete(&id)?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_api_key(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    let owner = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        match load_provider(&conn, &id) {
            Ok(r) => providers::key_owner(&r),
            Err(_) => id,
        }
    };
    credentials::delete(&owner)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    pub models: Vec<ModelInfo>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[tauri::command]
pub async fn test_provider(db: State<'_, Db>, id: String) -> Result<TestResult, AppError> {
    let record = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        let r = load_provider(&conn, &id)?;
        r
    };
    let key = providers::key_for(&record)?;
    let result = providers::list_models(&record, key.as_deref()).await;

    let (status, err) = match &result {
        Ok(_) => ("ok", None),
        Err(e) => ("error", Some(format!("{}: {}", e.code(), e))),
    };
    {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        conn.execute(
            "UPDATE providers SET last_status = ?1, last_error = ?2,
               last_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?3",
            params![status, err, id],
        )?;
    }
    Ok(match result {
        Ok(models) => TestResult {
            ok: true,
            models,
            error_code: None,
            error_message: None,
        },
        Err(e) => TestResult {
            ok: false,
            models: vec![],
            error_code: Some(e.code().to_string()),
            error_message: Some(e.to_string()),
        },
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultRow {
    pub category: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
}

#[tauri::command]
pub fn set_default(
    db: State<'_, Db>,
    category: String,
    provider_id: String,
) -> Result<(), AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let rec = load_provider(&conn, &provider_id)?;
    if rec.category != category {
        return Err(AppError::Invalid("provider category mismatch".into()));
    }
    conn.execute(
        "INSERT INTO provider_defaults (category, provider_id, model) VALUES (?1, ?2, ?3)
         ON CONFLICT(category) DO UPDATE SET provider_id = excluded.provider_id, model = excluded.model",
        params![category, provider_id, saved_model(&rec)],
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_defaults(db: State<'_, Db>) -> Result<Vec<DefaultRow>, AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let mut stmt = conn.prepare("SELECT category, provider_id, model FROM provider_defaults")?;
    let rows = stmt.query_map([], |r| {
        Ok(DefaultRow {
            category: r.get(0)?,
            provider_id: r.get(1)?,
            model: r.get(2)?,
        })
    })?;
    let collected = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(collected)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FallbackRow {
    pub category: String,
    pub position: i64,
    pub provider_id: String,
    pub model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FallbackEntry {
    pub provider_id: String,
    pub model: Option<String>,
}

#[tauri::command]
pub fn set_fallback_chain(
    db: State<'_, Db>,
    category: String,
    entries: Vec<FallbackEntry>,
) -> Result<(), AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM fallback_chains WHERE category = ?1",
        [&category],
    )?;
    for (i, e) in entries.iter().enumerate() {
        tx.execute(
            "INSERT INTO fallback_chains (category, position, provider_id, model) VALUES (?1, ?2, ?3, ?4)",
            params![category, i as i64, e.provider_id, e.model],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn get_fallback_chains(db: State<'_, Db>) -> Result<Vec<FallbackRow>, AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let mut stmt = conn.prepare(
        "SELECT category, position, provider_id, model FROM fallback_chains ORDER BY category, position",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(FallbackRow {
            category: r.get(0)?,
            position: r.get(1)?,
            provider_id: r.get(2)?,
            model: r.get(3)?,
        })
    })?;
    let collected = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(collected)
}

/// Models the provider offers for its job (synced live; nothing is stored).
#[tauri::command]
pub async fn list_provider_models(
    db: State<'_, Db>,
    id: String,
) -> Result<Vec<ModelInfo>, AppError> {
    let record = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        load_provider(&conn, &id)?
    };
    let key = providers::key_for(&record)?;
    providers::list_models(&record, key.as_deref()).await
}

fn write_model(conn: &Connection, id: &str, model: &str) -> Result<(), AppError> {
    let rec = load_provider(conn, id)?;
    let mut v: serde_json::Value = rec
        .settings_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .filter(|v: &serde_json::Value| v.is_object())
        .unwrap_or_else(|| serde_json::json!({}));
    v["model"] = serde_json::json!(model.trim());
    conn.execute(
        "UPDATE providers SET settings_json = ?1 WHERE id = ?2",
        params![v.to_string(), id],
    )?;
    Ok(())
}

/// Choose the model this provider uses for its page (Content, Voice, ...).
#[tauri::command]
pub fn set_provider_model(
    db: State<'_, Db>,
    id: String,
    model: String,
) -> Result<ProviderDto, AppError> {
    let m = model.trim();
    if m.is_empty() || m.chars().count() > 200 {
        return Err(AppError::Invalid(
            "model name must be 1-200 characters".into(),
        ));
    }
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    write_model(&conn, &id, m)?;
    conn.execute(
        "UPDATE provider_defaults SET model = ?1 WHERE provider_id = ?2",
        params![m, id],
    )?;
    let rec = load_provider(&conn, &id)?;
    drop(conn);
    to_dto(rec)
}

/// Use the same key for another job (for example one Gemini key for text, voice and
/// transcription). Creates a provider for `category` that borrows the key, syncs the model
/// list, picks a sensible model and makes it the default for that job if none is set.
#[tauri::command]
pub async fn link_provider(
    db: State<'_, Db>,
    source_id: String,
    category: String,
) -> Result<ProviderDto, AppError> {
    if !CATEGORIES.contains(&category.as_str()) || adapters_for(&category).is_empty() {
        return Err(AppError::Invalid("unsupported provider type".into()));
    }
    let source = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        load_provider(&conn, &source_id)?
    };
    let owner = providers::key_owner(&source);
    let adapter = providers::linked_adapter(&source.adapter, &category)
        .ok_or_else(|| AppError::Invalid("this provider cannot be reused for that job".into()))?;

    // Already linked? Return it.
    let existing = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        let id: Option<String> = conn
            .query_row(
                "SELECT id FROM providers WHERE category = ?1
                   AND (id = ?2 OR json_extract(settings_json, '$.keyFrom') = ?2)",
                params![category, owner],
                |r| r.get(0),
            )
            .optional()?;
        match id {
            Some(id) => Some(load_provider(&conn, &id)?),
            None => None,
        }
    };
    if let Some(rec) = existing {
        return to_dto(rec);
    }

    let owner_rec = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        load_provider(&conn, &owner)?
    };
    // Image generation is billed on most services; the other jobs keep the source's class.
    let cost_class = if category == "image" {
        "paid".to_string()
    } else {
        owner_rec.cost_class.clone()
    };
    let new_id = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        let suffix: String =
            conn.query_row("SELECT lower(hex(randomblob(4)))", [], |r| r.get(0))?;
        let id = format!("{adapter}-{suffix}");
        conn.execute(
            "INSERT INTO providers (id, category, adapter, display_name, endpoint, enabled, cost_class, settings_json)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7)",
            params![
                id,
                category,
                adapter,
                owner_rec.display_name,
                owner_rec.endpoint,
                cost_class,
                serde_json::json!({ "keyFrom": owner }).to_string()
            ],
        )?;
        id
    };

    // Sync models and pick a starting one. Failure is fine: the user can pick later.
    let rec = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        load_provider(&conn, &new_id)?
    };
    let key = providers::key_for(&rec)?;
    if let Ok(models) = providers::list_models(&rec, key.as_deref()).await {
        if let Some(m) = providers::pick_default_model(&category, &models) {
            let conn = db.0.lock().map_err(|_| AppError::Lock)?;
            write_model(&conn, &new_id, &m)?;
        }
    }
    let rec = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        let has_default: Option<String> = conn
            .query_row(
                "SELECT provider_id FROM provider_defaults WHERE category = ?1",
                [&category],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        let rec = load_provider(&conn, &new_id)?;
        if has_default.is_none() && saved_model(&rec).is_some() {
            conn.execute(
                "INSERT INTO provider_defaults (category, provider_id, model) VALUES (?1, ?2, ?3)
                 ON CONFLICT(category) DO UPDATE SET provider_id = excluded.provider_id, model = excluded.model",
                params![category, new_id, saved_model(&rec)],
            )?;
        }
        rec
    };
    to_dto(rec)
}
