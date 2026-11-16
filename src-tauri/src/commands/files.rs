//! Native file dialogs live in Rust so the frontend never supplies a filesystem
//! path: the user picks the location in an OS dialog and Rust reads/writes it.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::error::AppError;

const MAX_IMPORT_BYTES: u64 = 30 * 1024 * 1024;

fn safe_file_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect()
}

/// Ask the user where to save, then write the (base64-encoded) bytes there.
/// Returns the chosen path, or `None` if the user cancelled.
#[tauri::command]
pub async fn export_file(
    app: AppHandle,
    suggested_name: String,
    filter_name: String,
    extensions: Vec<String>,
    data_b64: String,
) -> Result<Option<String>, AppError> {
    let bytes = STANDARD
        .decode(data_b64.as_bytes())
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let picked = app
        .dialog()
        .file()
        .set_file_name(safe_file_name(&suggested_name))
        .add_filter(&filter_name, &exts)
        .blocking_save_file();
    let Some(fp) = picked else { return Ok(None) };
    let path = fp
        .into_path()
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    std::fs::write(&path, bytes)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    pub name: String,
    pub mime: String,
    pub data_b64: String,
}

fn mime_for(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "mp4" => "video/mp4",
        "srt" | "vtt" | "txt" => "text/plain",
        _ => "application/octet-stream",
    }
}

/// Let the user pick a file and return its bytes (size-capped).
#[tauri::command]
pub async fn import_file(
    app: AppHandle,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<PickedFile>, AppError> {
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let picked = app
        .dialog()
        .file()
        .add_filter(&filter_name, &exts)
        .blocking_pick_file();
    let Some(fp) = picked else { return Ok(None) };
    let path = fp
        .into_path()
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    let size = std::fs::metadata(&path)?.len();
    if size > MAX_IMPORT_BYTES {
        return Err(AppError::Invalid(format!(
            "file is larger than {} MB",
            MAX_IMPORT_BYTES / 1024 / 1024
        )));
    }
    let bytes = std::fs::read(&path)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    Ok(Some(PickedFile {
        name,
        mime: mime_for(ext).to_string(),
        data_b64: STANDARD.encode(bytes),
    }))
}
