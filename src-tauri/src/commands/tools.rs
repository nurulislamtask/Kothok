//! Optional local tools. FFmpeg is used to shrink or split long audio before cloud transcription.
//! It is downloaded on demand (never bundled), over HTTPS, and checked against the SHA-256 the
//! publisher posts next to the archive.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};

use crate::error::AppError;
use crate::paths::AppPaths;
use crate::providers::stt::{SttOutput, SttSegment};

const FFMPEG_ZIP: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const MAX_ZIP_BYTES: u64 = 300 * 1024 * 1024;
pub const SEGMENT_SECONDS: u64 = 600;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsStatus {
    pub ffmpeg: bool,
    /// "app" (downloaded by Kothok), "system" (found on PATH) or null.
    pub ffmpeg_source: Option<String>,
    pub whisper_engine: bool,
    /// Installed whisper.cpp model names (for example "small").
    pub whisper_models: Vec<String>,
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
        whisper_engine: whisper_cli(&paths).is_some(),
        whisper_models: WHISPER_MODELS
            .iter()
            .filter(|m| model_path(&paths, m).is_file())
            .map(|m| (*m).to_string())
            .collect(),
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

// ---------------------------------------------------------------------------------------------
// Local transcription with whisper.cpp (free, offline once installed)
// ---------------------------------------------------------------------------------------------

pub const WHISPER_MODELS: &[&str] = &["base", "small", "medium"];
const WHISPER_RELEASE_API: &str =
    "https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest";
const WHISPER_DOWNLOAD_PREFIX: &str = "https://github.com/ggml-org/whisper.cpp/releases/download/";
const HF_TREE_API: &str = "https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main";
const HF_RESOLVE: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";

fn whisper_dir(paths: &AppPaths) -> PathBuf {
    paths.tools.join("whisper")
}

fn whisper_cli(paths: &AppPaths) -> Option<PathBuf> {
    ["whisper-cli.exe", "main.exe"]
        .iter()
        .map(|n| whisper_dir(paths).join(n))
        .find(|p| p.is_file())
}

fn model_path(paths: &AppPaths, name: &str) -> PathBuf {
    whisper_dir(paths)
        .join("models")
        .join(format!("ggml-{name}.bin"))
}

#[derive(Serialize, Clone)]
struct Progress<'a> {
    tool: &'a str,
    done: u64,
    total: u64,
}

fn http() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .user_agent(concat!("Kothok/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| AppError::Network(e.to_string()))
}

fn net(e: reqwest::Error) -> AppError {
    AppError::Network(e.without_url().to_string())
}

/// Stream a download to `dest`, reporting progress, enforcing a size cap and an optional SHA-256.
async fn download_checked(
    app: &AppHandle,
    tool: &str,
    url: &str,
    dest: &Path,
    max: u64,
    expected_sha: Option<&str>,
) -> Result<(), AppError> {
    let mut resp = http()?
        .get(url)
        .send()
        .await
        .map_err(net)?
        .error_for_status()
        .map_err(net)?;
    let total = resp.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(dest)?;
    let mut hasher = Sha256::new();
    let mut done = 0u64;
    let mut last_emit = 0u64;
    while let Some(chunk) = resp.chunk().await.map_err(net)? {
        done += chunk.len() as u64;
        if done > max {
            drop(file);
            let _ = std::fs::remove_file(dest);
            return Err(AppError::Invalid(
                "the download is larger than expected".into(),
            ));
        }
        hasher.update(&chunk);
        std::io::Write::write_all(&mut file, &chunk)?;
        if done - last_emit > 512 * 1024 {
            last_emit = done;
            let _ = app.emit("tool-progress", Progress { tool, done, total });
        }
    }
    drop(file);
    let _ = app.emit(
        "tool-progress",
        Progress {
            tool,
            done,
            total: done,
        },
    );
    if let Some(want) = expected_sha {
        if format!("{:x}", hasher.finalize()) != want.to_ascii_lowercase() {
            let _ = std::fs::remove_file(dest);
            return Err(AppError::BadResponse(
                "the download failed its checksum and was discarded".into(),
            ));
        }
    }
    Ok(())
}

/// (file name, download url, sha256 if GitHub publishes one) of the CPU Windows build.
pub fn pick_whisper_asset(release: &Value) -> Option<(String, String, Option<String>)> {
    release.get("assets")?.as_array()?.iter().find_map(|a| {
        let name = a.get("name")?.as_str()?;
        let lower = name.to_ascii_lowercase();
        let ok = lower.ends_with(".zip")
            && lower.contains("bin-x64")
            && !["cublas", "blas", "cuda", "vulkan", "openblas"]
                .iter()
                .any(|w| lower.contains(w));
        let url = a.get("browser_download_url")?.as_str()?;
        if !ok || !url.starts_with(WHISPER_DOWNLOAD_PREFIX) {
            return None;
        }
        let digest = a
            .get("digest")
            .and_then(|d| d.as_str())
            .and_then(|d| d.strip_prefix("sha256:"))
            .map(String::from);
        Some((name.to_string(), url.to_string(), digest))
    })
}

/// (sha256, size) of a model file from the Hugging Face tree listing.
pub fn find_model_sha(tree: &Value, file: &str) -> Option<(String, u64)> {
    tree.as_array()?.iter().find_map(|e| {
        if e.get("path")?.as_str()? != file {
            return None;
        }
        let lfs = e.get("lfs")?;
        let oid = lfs.get("oid")?.as_str()?.to_ascii_lowercase();
        (oid.len() == 64 && oid.chars().all(|c| c.is_ascii_hexdigit()))
            .then(|| (oid, lfs.get("size").and_then(|s| s.as_u64()).unwrap_or(0)))
    })
}

#[tauri::command]
pub async fn install_whisper_engine(
    app: AppHandle,
    paths: State<'_, AppPaths>,
) -> Result<(), AppError> {
    let dir = whisper_dir(&paths);
    std::fs::create_dir_all(dir.join("models"))?;
    let release: Value = http()?
        .get(WHISPER_RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(net)?
        .error_for_status()
        .map_err(net)?
        .json()
        .await
        .map_err(|e| AppError::BadResponse(e.to_string()))?;
    let (_, url, digest) = pick_whisper_asset(&release).ok_or_else(|| {
        AppError::BadResponse(
            "no Windows build of whisper.cpp was found in the latest release".into(),
        )
    })?;
    let zip_path = paths.temp.join("whisper-engine.zip");
    download_checked(
        &app,
        "whisper-engine",
        &url,
        &zip_path,
        400 * 1024 * 1024,
        digest.as_deref(),
    )
    .await?;
    let target = dir.clone();
    tauri::async_runtime::spawn_blocking(move || extract_whisper(&zip_path, &target))
        .await
        .map_err(|e| AppError::Invalid(e.to_string()))?
}

/// Copy the program and its DLLs out of the archive (flat), nothing else.
pub fn extract_whisper(zip_path: &Path, dir: &Path) -> Result<(), AppError> {
    let f = std::fs::File::open(zip_path)?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| AppError::BadResponse(e.to_string()))?;
    let mut found = false;
    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| AppError::BadResponse(e.to_string()))?;
        if entry.is_dir() {
            continue;
        }
        let Some(name) = entry.name().rsplit('/').next().map(str::to_string) else {
            continue;
        };
        let lower = name.to_ascii_lowercase();
        let safe = !name.is_empty()
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
        if !safe || !(lower.ends_with(".exe") || lower.ends_with(".dll")) {
            continue;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf)?;
        std::fs::write(dir.join(&name), buf)?;
        found |= lower == "whisper-cli.exe" || lower == "main.exe";
    }
    let _ = std::fs::remove_file(zip_path);
    if found {
        Ok(())
    } else {
        Err(AppError::BadResponse(
            "whisper-cli.exe was not found in the archive".into(),
        ))
    }
}

#[tauri::command]
pub async fn install_whisper_model(
    app: AppHandle,
    paths: State<'_, AppPaths>,
    name: String,
) -> Result<(), AppError> {
    if !WHISPER_MODELS.contains(&name.as_str()) {
        return Err(AppError::Invalid("unknown model".into()));
    }
    let file = format!("ggml-{name}.bin");
    let tree: Value = http()?
        .get(HF_TREE_API)
        .send()
        .await
        .map_err(net)?
        .error_for_status()
        .map_err(net)?
        .json()
        .await
        .map_err(|e| AppError::BadResponse(e.to_string()))?;
    let (sha, size) = find_model_sha(&tree, &file)
        .ok_or_else(|| AppError::BadResponse("the model's checksum was not published".into()))?;
    std::fs::create_dir_all(whisper_dir(&paths).join("models"))?;
    let dest = model_path(&paths, &name);
    let part = dest.with_extension("bin.part");
    let cap = if size > 0 {
        size + 1024 * 1024
    } else {
        3 * 1024 * 1024 * 1024
    };
    download_checked(
        &app,
        &format!("whisper-model-{name}"),
        &format!("{HF_RESOLVE}{file}"),
        &part,
        cap,
        Some(&sha),
    )
    .await?;
    std::fs::rename(&part, &dest)?;
    Ok(())
}

/// Convert to 16 kHz mono WAV with FFmpeg and run whisper-cli. Blocking.
pub fn whisper_transcribe(
    paths: &AppPaths,
    ffmpeg: &Path,
    model: &str,
    lang: Option<&str>,
    input: &Path,
) -> Result<SttOutput, AppError> {
    let cli = whisper_cli(paths).ok_or_else(|| {
        AppError::Invalid("the local engine is not installed; see Settings → Tools".into())
    })?;
    if !WHISPER_MODELS.contains(&model) {
        return Err(AppError::Invalid("unknown local model".into()));
    }
    let model_file = model_path(paths, model);
    if !model_file.is_file() {
        return Err(AppError::Invalid(format!(
            "the local model “{model}” is not installed; see Settings → Tools"
        )));
    }
    let work = paths
        .temp
        .join(format!("whisper-{}", crate::paths::random_stem()));
    std::fs::create_dir_all(&work)?;
    let result = (|| {
        let wav = work.join("audio.wav");
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
                "-c:a",
                "pcm_s16le",
                &wav.to_string_lossy(),
            ],
        )?;
        let prefix = work.join("out");
        let threads = std::thread::available_parallelism()
            .map(|n| n.get().min(8))
            .unwrap_or(4)
            .to_string();
        let lang = lang
            .filter(|l| !l.is_empty() && l.len() <= 3 && l.chars().all(|c| c.is_ascii_lowercase()))
            .unwrap_or("auto");
        let out = quiet(&mut Command::new(&cli))
            .current_dir(whisper_dir(paths))
            .args([
                "-m",
                &model_file.to_string_lossy(),
                "-f",
                &wav.to_string_lossy(),
                "-l",
                lang,
                "-oj",
                "-of",
                &prefix.to_string_lossy(),
                "-np",
                "-t",
                &threads,
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            let tail: String = err
                .chars()
                .rev()
                .take(300)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            return Err(AppError::Invalid(format!(
                "the local engine failed: {tail}"
            )));
        }
        let json: Value = serde_json::from_slice(&std::fs::read(work.join("out.json"))?)
            .map_err(|e| AppError::BadResponse(e.to_string()))?;
        parse_whisper_json(&json)
    })();
    let _ = std::fs::remove_dir_all(&work);
    result
}

pub fn parse_whisper_json(v: &Value) -> Result<SttOutput, AppError> {
    let segments: Vec<SttSegment> = v
        .get("transcription")
        .and_then(|t| t.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|s| {
                    let text = s.get("text")?.as_str()?.trim().to_string();
                    if text.is_empty() {
                        return None;
                    }
                    Some(SttSegment {
                        start_ms: s.pointer("/offsets/from")?.as_i64()?,
                        end_ms: s.pointer("/offsets/to")?.as_i64()?,
                        text,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    if segments.is_empty() {
        return Err(AppError::BadResponse("no speech was recognised".into()));
    }
    let language = v
        .pointer("/result/language")
        .and_then(|l| l.as_str())
        .map(String::from);
    let text = segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    Ok(SttOutput {
        text,
        language,
        segments,
        has_timing: true,
    })
}

#[cfg(test)]
mod whisper_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_whisper_cli_json() {
        let v = json!({"result":{"language":"bn"},"transcription":[
            {"timestamps":{"from":"00:00:00,000","to":"00:00:02,000"},"offsets":{"from":0,"to":2000},"text":" আমি ভালো আছি"},
            {"offsets":{"from":2000,"to":3500},"text":" "}]});
        let o = parse_whisper_json(&v).unwrap();
        assert_eq!(o.segments.len(), 1);
        assert_eq!(o.segments[0].end_ms, 2000);
        assert_eq!(o.language.as_deref(), Some("bn"));
        assert!(parse_whisper_json(&json!({"transcription":[]})).is_err());
    }

    #[test]
    fn picks_cpu_windows_asset_only() {
        let u = |n: &str| format!("{WHISPER_DOWNLOAD_PREFIX}v1.8.0/{n}");
        let r = json!({"assets":[
            {"name":"whisper-cublas-12.4.0-bin-x64.zip","browser_download_url":u("whisper-cublas-12.4.0-bin-x64.zip")},
            {"name":"whisper-bin-Win32.zip","browser_download_url":u("whisper-bin-Win32.zip")},
            {"name":"whisper-bin-x64.zip","browser_download_url":u("whisper-bin-x64.zip"),"digest":"sha256:abc"}]});
        let (name, _, digest) = pick_whisper_asset(&r).unwrap();
        assert_eq!(name, "whisper-bin-x64.zip");
        assert_eq!(digest.as_deref(), Some("abc"));
        let foreign = json!({"assets":[{"name":"whisper-bin-x64.zip","browser_download_url":"https://evil.example/whisper-bin-x64.zip"}]});
        assert!(pick_whisper_asset(&foreign).is_none());
    }

    #[test]
    fn finds_model_checksum() {
        let h = "a".repeat(64);
        let t = json!([{"path":"ggml-small.bin","lfs":{"oid":h,"size":466}},{"path":"README.md"}]);
        assert_eq!(find_model_sha(&t, "ggml-small.bin"), Some((h, 466)));
        assert!(find_model_sha(&t, "ggml-medium.bin").is_none());
    }

    #[test]
    fn extracts_cli_and_dlls_only() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("kothok-wh-{}", crate::paths::random_stem()));
        std::fs::create_dir_all(&dir).unwrap();
        let zp = dir.join("w.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&zp).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            for (n, d) in [
                ("Release/whisper-cli.exe", &b"MZ1"[..]),
                ("Release/whisper.dll", b"MZ2"),
                ("Release/readme.txt", b"hi"),
            ] {
                w.start_file(n, o).unwrap();
                w.write_all(d).unwrap();
            }
            w.finish().unwrap();
        }
        extract_whisper(&zp, &dir).unwrap();
        assert!(dir.join("whisper-cli.exe").is_file());
        assert!(dir.join("whisper.dll").is_file());
        assert!(!dir.join("readme.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
