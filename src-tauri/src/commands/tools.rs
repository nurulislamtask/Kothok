//! Optional local tools. FFmpeg is used to shrink or split long audio before cloud transcription.
//! It is downloaded on demand (never bundled), over HTTPS, and checked against the SHA-256 the
//! publisher posts next to the archive.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::error::AppError;
use crate::paths::AppPaths;

const FFMPEG_ZIP: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const MAX_ZIP_BYTES: u64 = 300 * 1024 * 1024;
pub const SEGMENT_SECONDS: u64 = 600;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsStatus {
    pub ffmpeg: bool,
    /// "app" (downloaded by Kothok), "system" (found on PATH) or null.
    pub ffmpeg_source: Option<String>,
}

fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.stdin(Stdio::null())
}

pub fn ffmpeg_path(paths: &AppPaths) -> Option<(PathBuf, &'static str)> {
    let own = paths.tools.join("ffmpeg.exe");
    if own.is_file() {
        return Some((own, "app"));
    }
    let ok = quiet(&mut Command::new("ffmpeg"))
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    ok.then(|| (PathBuf::from("ffmpeg"), "system"))
}

#[tauri::command]
pub fn tools_status(paths: State<'_, AppPaths>) -> ToolsStatus {
    let f = ffmpeg_path(&paths);
    ToolsStatus {
        ffmpeg: f.is_some(),
        ffmpeg_source: f.map(|(_, s)| s.to_string()),
    }
}

#[tauri::command]
pub async fn install_ffmpeg(paths: State<'_, AppPaths>) -> Result<(), AppError> {
    let tools = paths.tools.clone();
    let temp = paths.temp.clone();
    let http = reqwest::Client::builder()
        .user_agent(concat!("Kothok/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(1200))
        .build()
        .map_err(|e| AppError::Network(e.to_string()))?;
    let net = |e: reqwest::Error| AppError::Network(e.without_url().to_string());

    let sum = http
        .get(format!("{FFMPEG_ZIP}.sha256"))
        .send()
        .await
        .map_err(net)?
        .error_for_status()
        .map_err(net)?
        .text()
        .await
        .map_err(net)?;
    let expected = sum
        .split_whitespace()
        .next()
        .map(str::to_ascii_lowercase)
        .filter(|h| h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()))
        .ok_or_else(|| AppError::BadResponse("the FFmpeg checksum file is invalid".into()))?;

    let mut resp = http
        .get(FFMPEG_ZIP)
        .send()
        .await
        .map_err(net)?
        .error_for_status()
        .map_err(net)?;
    let zip_path = temp.join("ffmpeg-download.zip");
    let mut file = std::fs::File::create(&zip_path)?;
    let mut hasher = Sha256::new();
    let mut total = 0u64;
    while let Some(chunk) = resp.chunk().await.map_err(net)? {
        total += chunk.len() as u64;
        if total > MAX_ZIP_BYTES {
            drop(file);
            let _ = std::fs::remove_file(&zip_path);
            return Err(AppError::Invalid("the FFmpeg download is too large".into()));
        }
        hasher.update(&chunk);
        std::io::Write::write_all(&mut file, &chunk)?;
    }
    drop(file);
    if format!("{:x}", hasher.finalize()) != expected {
        let _ = std::fs::remove_file(&zip_path);
        return Err(AppError::BadResponse(
            "the FFmpeg download failed its checksum and was discarded".into(),
        ));
    }
    let result = tauri::async_runtime::spawn_blocking(move || extract_ffmpeg(&zip_path, &tools))
        .await
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    result
}

/// Pull `bin/ffmpeg.exe` out of the archive into the tools folder.
pub fn extract_ffmpeg(zip_path: &Path, tools: &Path) -> Result<(), AppError> {
    let f = std::fs::File::open(zip_path)?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| AppError::BadResponse(e.to_string()))?;
    let mut idx = None;
    for i in 0..zip.len() {
        let name = zip
            .by_index(i)
            .map_err(|e| AppError::BadResponse(e.to_string()))?
            .name()
            .to_string();
        if name.ends_with("/bin/ffmpeg.exe") {
            idx = Some(i);
            break;
        }
    }
    let idx =
        idx.ok_or_else(|| AppError::BadResponse("ffmpeg.exe not found in the archive".into()))?;
    let mut entry = zip
        .by_index(idx)
        .map_err(|e| AppError::BadResponse(e.to_string()))?;
    let tmp = tools.join("ffmpeg.exe.part");
    let mut out = std::fs::File::create(&tmp)?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf)?;
    std::io::Write::write_all(&mut out, &buf)?;
    drop(out);
    std::fs::rename(&tmp, tools.join("ffmpeg.exe"))?;
    let _ = std::fs::remove_file(zip_path);
    Ok(())
}

/// Shrink to mono 16 kHz 32 kbps MP3, and split into ten-minute pieces if still too big.
/// Returns (file, start offset in ms) pairs. Blocking.
pub fn prepare_audio(
    ffmpeg: &Path,
    input: &Path,
    workdir: &Path,
    limit: u64,
) -> Result<Vec<(PathBuf, i64)>, AppError> {
    let small = workdir.join("small.mp3");
    run(
        ffmpeg,
        &[
            "-y",
            "-i",
            &input.to_string_lossy(),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-b:a",
            "32k",
            &small.to_string_lossy(),
        ],
    )?;
    if std::fs::metadata(&small)?.len() <= limit {
        return Ok(vec![(small, 0)]);
    }
    let pattern = workdir.join("part_%03d.mp3");
    run(
        ffmpeg,
        &[
            "-y",
            "-i",
            &small.to_string_lossy(),
            "-f",
            "segment",
            "-segment_time",
            &SEGMENT_SECONDS.to_string(),
            "-c",
            "copy",
            &pattern.to_string_lossy(),
        ],
    )?;
    let _ = std::fs::remove_file(&small);
    let mut parts: Vec<PathBuf> = std::fs::read_dir(workdir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("part_"))
        })
        .collect();
    parts.sort();
    if parts.is_empty() {
        return Err(AppError::BadResponse("FFmpeg produced no audio".into()));
    }
    Ok(parts
        .into_iter()
        .enumerate()
        .map(|(i, p)| (p, i as i64 * SEGMENT_SECONDS as i64 * 1000))
        .collect())
}

fn run(ffmpeg: &Path, args: &[&str]) -> Result<(), AppError> {
    let out = quiet(&mut Command::new(ffmpeg))
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()?;
    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let tail: String = err
        .chars()
        .rev()
        .take(300)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    Err(AppError::Invalid(format!(
        "FFmpeg could not process this audio: {tail}"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn extracts_ffmpeg_from_archive() {
        let dir = std::env::temp_dir().join(format!("kothok-zip-{}", crate::paths::random_stem()));
        std::fs::create_dir_all(&dir).unwrap();
        let zp = dir.join("a.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&zp).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            w.start_file("ffmpeg-7/bin/ffprobe.exe", o).unwrap();
            w.write_all(b"probe").unwrap();
            w.start_file("ffmpeg-7/bin/ffmpeg.exe", o).unwrap();
            w.write_all(b"MZfake").unwrap();
            w.finish().unwrap();
        }
        extract_ffmpeg(&zp, &dir).unwrap();
        assert_eq!(std::fs::read(dir.join("ffmpeg.exe")).unwrap(), b"MZfake");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
