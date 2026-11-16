//! Local project / asset storage (metadata + text bodies in SQLite).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::Db;
use crate::error::AppError;

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const KINDS: &[&str] = &[
    "content",
    "audio",
    "thumbnail",
    "subtitle",
    "transcript",
    "voice_sample",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: i64,
    pub name: String,
    pub folder_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub asset_count: i64,
}

fn project_by_id(conn: &Connection, id: i64) -> Result<ProjectDto, AppError> {
    let p = conn
        .query_row(
            "SELECT p.id, p.name, p.folder_id, p.created_at, p.updated_at,
                    (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id)
             FROM projects p WHERE p.id = ?1",
            [id],
            |r| {
                Ok(ProjectDto {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    folder_id: r.get(2)?,
                    created_at: r.get(3)?,
                    updated_at: r.get(4)?,
                    asset_count: r.get(5)?,
                })
            },
        )
        .optional()?;
    p.ok_or_else(|| AppError::Invalid("project not found".into()))
}

fn clean_name(name: &str) -> Result<String, AppError> {
    let n = name.trim();
    if n.is_empty() || n.chars().count() > 120 {
        return Err(AppError::Invalid("name must be 1-120 characters".into()));
    }
    Ok(n.to_string())
}

#[tauri::command]
pub fn list_projects(db: State<'_, Db>) -> Result<Vec<ProjectDto>, AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let ids: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT id FROM projects ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], |r| r.get::<_, i64>(0))?;
        let collected = rows.collect::<Result<Vec<_>, _>>()?;
        collected
    };
    ids.into_iter().map(|id| project_by_id(&conn, id)).collect()
}

#[tauri::command]
pub fn create_project(db: State<'_, Db>, name: String) -> Result<ProjectDto, AppError> {
    let name = clean_name(&name)?;
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    conn.execute(
        &format!("INSERT INTO projects (name, created_at, updated_at) VALUES (?1, {NOW}, {NOW})"),
        [&name],
    )?;
    project_by_id(&conn, conn.last_insert_rowid())
}

#[tauri::command]
pub fn rename_project(db: State<'_, Db>, id: i64, name: String) -> Result<ProjectDto, AppError> {
    let name = clean_name(&name)?;
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    conn.execute(
        &format!("UPDATE projects SET name = ?1, updated_at = {NOW} WHERE id = ?2"),
        params![name, id],
    )?;
    project_by_id(&conn, id)
}

#[tauri::command]
pub fn delete_project(db: State<'_, Db>, id: i64) -> Result<(), AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDto {
    pub id: i64,
    pub project_id: Option<i64>,
    pub kind: String,
    pub title: Option<String>,
    pub file_path: Option<String>,
    pub body: Option<String>,
    pub lang: Option<String>,
    pub meta_json: Option<String>,
    pub created_at: String,
}

const ASSET_COLS: &str =
    "id, project_id, kind, title, file_path, body, lang, meta_json, created_at";

fn asset_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<AssetDto> {
    Ok(AssetDto {
        id: r.get(0)?,
        project_id: r.get(1)?,
        kind: r.get(2)?,
        title: r.get(3)?,
        file_path: r.get(4)?,
        body: r.get(5)?,
        lang: r.get(6)?,
        meta_json: r.get(7)?,
        created_at: r.get(8)?,
    })
}

fn asset_by_id(conn: &Connection, id: i64) -> Result<AssetDto, AppError> {
    let a = conn
        .query_row(
            &format!("SELECT {ASSET_COLS} FROM assets WHERE id = ?1"),
            [id],
            asset_row,
        )
        .optional()?;
    a.ok_or_else(|| AppError::Invalid("asset not found".into()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetInput {
    pub id: Option<i64>,
    pub project_id: Option<i64>,
    pub kind: String,
    pub title: Option<String>,
    pub body: Option<String>,
    pub lang: Option<String>,
    pub meta_json: Option<String>,
}

#[tauri::command]
pub fn save_asset(db: State<'_, Db>, input: AssetInput) -> Result<AssetDto, AppError> {
    if !KINDS.contains(&input.kind.as_str()) {
        return Err(AppError::Invalid("unknown asset kind".into()));
    }
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let id = match input.id {
        Some(id) => {
            conn.execute(
                "UPDATE assets SET project_id = ?1, kind = ?2, title = ?3, body = ?4, lang = ?5, meta_json = ?6
                 WHERE id = ?7",
                params![input.project_id, input.kind, input.title, input.body, input.lang, input.meta_json, id],
            )?;
            id
        }
        None => {
            conn.execute(
                &format!(
                    "INSERT INTO assets (project_id, kind, title, body, lang, meta_json, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, {NOW})"
                ),
                params![
                    input.project_id,
                    input.kind,
                    input.title,
                    input.body,
                    input.lang,
                    input.meta_json
                ],
            )?;
            conn.last_insert_rowid()
        }
    };
    if let Some(pid) = input.project_id {
        conn.execute(
            &format!("UPDATE projects SET updated_at = {NOW} WHERE id = ?1"),
            [pid],
        )?;
    }
    asset_by_id(&conn, id)
}

#[tauri::command]
pub fn list_assets(
    db: State<'_, Db>,
    project_id: Option<i64>,
    kind: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<AssetDto>, AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {ASSET_COLS} FROM assets
         WHERE (?1 IS NULL OR project_id = ?1) AND (?2 IS NULL OR kind = ?2)
         ORDER BY created_at DESC, id DESC LIMIT ?3"
    ))?;
    let rows = stmt.query_map(
        params![project_id, kind, limit.unwrap_or(200).clamp(1, 1000)],
        asset_row,
    )?;
    let collected = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(collected)
}

#[tauri::command]
pub fn get_asset(db: State<'_, Db>, id: i64) -> Result<AssetDto, AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    asset_by_id(&conn, id)
}

#[tauri::command]
pub fn delete_asset(db: State<'_, Db>, id: i64) -> Result<(), AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    conn.execute("DELETE FROM assets WHERE id = ?1", [id])?;
    Ok(())
}
