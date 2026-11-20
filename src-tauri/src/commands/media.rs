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

/// Delete a media file the user picked but never saved anywhere. Files that a project asset,
/// voice profile or speech history entry still points at are left alone.
#[tauri::command]
pub fn discard_media(
    db: State<'_, crate::db::Db>,
    paths: State<'_, AppPaths>,
    path: String,
) -> Result<(), AppError> {
    let p = paths.media_path(&path)?;
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let used: i64 = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM assets WHERE file_path = ?1)
              + (SELECT COUNT(*) FROM voice_profiles WHERE sample_path = ?1)
              + (SELECT COUNT(*) FROM tts_history WHERE audio_path = ?1)",
        [&path],
        |r| r.get(0),
    )?;
    if used == 0 {
        let _ = std::fs::remove_file(p);
    }
    Ok(())
}

/// Parse a 16-bit PCM WAV: (channels, sample rate, data bytes).
pub fn parse_wav(b: &[u8]) -> Result<(u16, u32, &[u8]), AppError> {
    let bad = || AppError::BadResponse("not a plain PCM WAV file".into());
    if b.len() < 44 || &b[0..4] != b"RIFF" || &b[8..12] != b"WAVE" {
        return Err(bad());
    }
    let (mut pos, mut fmt, mut data) = (12usize, None, None);
    while pos + 8 <= b.len() {
        let id = &b[pos..pos + 4];
        let size = u32::from_le_bytes([b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]]) as usize;
        let body = pos + 8;
        let end = body.saturating_add(size).min(b.len());
        if id == b"fmt " && end - body >= 16 {
            let ch = u16::from_le_bytes([b[body + 2], b[body + 3]]);
            let rate = u32::from_le_bytes([b[body + 4], b[body + 5], b[body + 6], b[body + 7]]);
            let bits = u16::from_le_bytes([b[body + 14], b[body + 15]]);
            let tag = u16::from_le_bytes([b[body], b[body + 1]]);
            if tag != 1 || bits != 16 {
                return Err(bad());
            }
            fmt = Some((ch, rate));
        } else if id == b"data" {
            data = Some(&b[body..end]);
            break;
        }
        pos = body.saturating_add(size).saturating_add(size & 1);
    }
    match (fmt, data) {
        (Some((c, r)), Some(d)) => Ok((c, r, d)),
        _ => Err(bad()),
    }
}

/// Join WAV parts into one WAV with `gap_ms` of silence between them.
pub fn join_wavs(parts: &[Vec<u8>], gap_ms: u32) -> Result<Vec<u8>, AppError> {
    let mut fmt: Option<(u16, u32)> = None;
    let mut pcm: Vec<u8> = Vec::new();
    for (i, p) in parts.iter().enumerate() {
        let (c, r, d) = parse_wav(p)?;
        match fmt {
            None => fmt = Some((c, r)),
            Some(f) if f != (c, r) => {
                return Err(AppError::Invalid(
                    "the parts use different audio formats".into(),
                ))
            }
            _ => {}
        }
        if i > 0 {
            let gap = (r as u64 * gap_ms as u64 / 1000) as usize * c as usize * 2;
            pcm.extend(std::iter::repeat(0u8).take(gap));
        }
        pcm.extend_from_slice(d);
    }
    let (c, r) = fmt.ok_or_else(|| AppError::Invalid("nothing to join".into()))?;
    let mut out = Vec::with_capacity(pcm.len() + 44);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&c.to_le_bytes());
    out.extend_from_slice(&r.to_le_bytes());
    out.extend_from_slice(&(r * c as u32 * 2).to_le_bytes());
    out.extend_from_slice(&(c * 2).to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    out.extend_from_slice(&pcm);
    Ok(out)
}

/// Join several generated audio files (same kind) into one new file; returns its name.
#[tauri::command]
pub fn audio_join(
    paths: State<'_, AppPaths>,
    files: Vec<String>,
    gap_ms: Option<u32>,
) -> Result<String, AppError> {
    if files.is_empty() || files.len() > 200 {
        return Err(AppError::Invalid("choose between 1 and 200 files".into()));
    }
    let lower = files[0].to_ascii_lowercase();
    let wav = lower.ends_with(".wav");
    if files
        .iter()
        .any(|f| f.to_ascii_lowercase().ends_with(".wav") != wav)
    {
        return Err(AppError::Invalid("cannot mix WAV and MP3 parts".into()));
    }
    let mut parts = Vec::new();
    for f in &files {
        parts.push(std::fs::read(paths.media_path(f)?)?);
    }
    let (bytes, ext) = if wav {
        (join_wavs(&parts, gap_ms.unwrap_or(350).min(5000))?, "wav")
    } else {
        // MP3 frames are self-contained, so plain concatenation plays correctly.
        (parts.concat(), "mp3")
    };
    let file = format!("{}.{}", random_stem(), clean_ext(ext)?);
    std::fs::write(paths.media_path(&file)?, bytes)?;
    Ok(file)
}

#[cfg(test)]
mod join_tests {
    use super::*;

    fn wav(pcm: &[u8], rate: u32) -> Vec<u8> {
        crate::providers::gemini_media::wav_from_pcm(pcm, rate)
    }

    #[test]
    fn joins_with_silence() {
        let a = wav(&[1, 2, 3, 4], 1000);
        let b = wav(&[5, 6], 1000);
        let out = join_wavs(&[a, b], 10).unwrap();
        let (c, r, d) = parse_wav(&out).unwrap();
        assert_eq!((c, r), (1, 1000));
        // 10 ms at 1000 Hz = 10 samples = 20 bytes of silence
        assert_eq!(d.len(), 4 + 20 + 2);
        assert_eq!(&d[..4], &[1, 2, 3, 4]);
        assert_eq!(&d[24..], &[5, 6]);
    }

    #[test]
    fn rejects_mismatched_rates_and_junk() {
        assert!(join_wavs(&[wav(&[0, 0], 1000), wav(&[0, 0], 2000)], 0).is_err());
        assert!(parse_wav(b"nope").is_err());
    }
}
