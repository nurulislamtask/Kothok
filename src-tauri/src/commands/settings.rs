use rusqlite::OptionalExtension;
use tauri::State;

use crate::db::Db;
use crate::error::AppError;

#[tauri::command]
pub fn get_setting(db: State<'_, Db>, key: String) -> Result<Option<String>, AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let value = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [&key], |r| {
            r.get::<_, String>(0)
        })
        .optional()?;
    Ok(value)
}

#[tauri::command]
pub fn set_setting(db: State<'_, Db>, key: String, value: String) -> Result<(), AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [&key, &value],
    )?;
    Ok(())
}
