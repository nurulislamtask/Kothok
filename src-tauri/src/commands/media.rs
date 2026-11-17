//! Storage for generated / imported media inside the app-data folder.

use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::State;

use super::files::{mime_for, PickedFile};
use crate::error::AppError;
use crate::paths::{clean_ext, random_stem, AppPaths};

const MAX_MEDIA_BYTES: usize = 200 * 1024 * 1024;

/// Save bytes into the media folder and return the new relative file name.
#[tauri::command]
pub fn save_media(
    paths: State<'_, AppPaths>,
    ext: String,
    data_b64: String,
) -> Result<String, AppError> {
    let ext = clean_ext(&ext)?;
    let bytes = STANDARD
        .decode(data_b64.as_bytes())
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    if bytes.len() > MAX_MEDIA_BYTES {
        return Err(AppError::Invalid("file is too large".into()));
    }
    let name = format!("{}.{}", random_stem(), ext);
    std::fs::write(paths.media_path(&name)?, bytes)?;
    Ok(name)
}

#[tauri::command]
pub fn read_media(paths: State<'_, AppPaths>, path: String) -> Result<PickedFile, AppError> {
    let p = paths.media_path(&path)?;
    let bytes = std::fs::read(&p)?;
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
    Ok(PickedFile {
        name: path,
        mime: mime_for(ext).to_string(),
        data_b64: STANDARD.encode(bytes),
    })
}
