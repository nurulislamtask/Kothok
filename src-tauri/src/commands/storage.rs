//! Storage overview and cleanup for the media folder.

use std::collections::HashSet;

use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::error::AppError;
use crate::paths::AppPaths;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub media_files: u64,
    pub media_bytes: u64,
    pub unused_files: u64,
    pub unused_bytes: u64,
}

/// Every media file name that something in the database still points at.
fn referenced(conn: &rusqlite::Connection) -> Result<HashSet<String>, AppError> {
    let mut set = HashSet::new();
    for sql in [
        "SELECT file_path FROM assets WHERE file_path IS NOT NULL",
        "SELECT sample_path FROM voice_profiles",
        "SELECT audio_path FROM tts_history WHERE audio_path IS NOT NULL",
    ] {
        let mut stmt = conn.prepare(sql)?;
        for r in stmt.query_map([], |r| r.get::<_, String>(0))? {
            set.insert(r?);
        }
    }
    let mut stmt = conn.prepare("SELECT meta_json FROM assets WHERE meta_json IS NOT NULL")?;
    for r in stmt.query_map([], |r| r.get::<_, String>(0))? {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&r?) {
            if let Some(arr) = v.get("media").and_then(|m| m.as_array()) {
                set.extend(arr.iter().filter_map(|x| x.as_str().map(String::from)));
            }
        }
    }
    Ok(set)
}

fn scan(
    paths: &AppPaths,
    keep: &HashSet<String>,
) -> Result<(StorageInfo, Vec<std::path::PathBuf>), AppError> {
    let mut info = StorageInfo {
        media_files: 0,
        media_bytes: 0,
        unused_files: 0,
        unused_bytes: 0,
    };
    let mut unused = Vec::new();
    for entry in std::fs::read_dir(&paths.media)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if !meta.is_file() {
            continue;
        }
        info.media_files += 1;
        info.media_bytes += meta.len();
        let name = entry.file_name().to_string_lossy().into_owned();
        if !keep.contains(&name) {
            info.unused_files += 1;
            info.unused_bytes += meta.len();
            unused.push(entry.path());
        }
    }
    Ok((info, unused))
}

#[tauri::command]
pub fn storage_info(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
) -> Result<StorageInfo, AppError> {
    let keep = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        referenced(&conn)?
    };
    Ok(scan(&paths, &keep)?.0)
}

#[tauri::command]
pub fn clean_unused_media(db: State<'_, Db>, paths: State<'_, AppPaths>) -> Result<u64, AppError> {
    let keep = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        referenced(&conn)?
    };
    let (_, unused) = scan(&paths, &keep)?;
    let mut removed = 0;
    for p in unused {
        if std::fs::remove_file(p).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}
