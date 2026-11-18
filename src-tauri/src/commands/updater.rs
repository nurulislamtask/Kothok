//! In-app updates from GitHub Releases.
//!
//! The release workflow publishes every main build as `build-N` with the NSIS installer and a
//! `<installer>.sha256` file. The app knows its own build number (`KOTHOK_BUILD`, set by CI),
//! finds a newer release, downloads the installer over HTTPS, checks the SHA-256 and only then
//! starts it. Downloads are restricted to this project's release URLs.

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::paths::AppPaths;

const REPO: &str = "nurulislamtask/Kothok";
const MAX_INSTALLER_BYTES: u64 = 400 * 1024 * 1024;

pub fn current_build() -> u64 {
    option_env!("KOTHOK_BUILD")
        .and_then(|b| b.parse().ok())
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub build: u64,
    pub tag: String,
    pub installer_url: String,
    pub size: u64,
    pub notes: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub build: u64,
    pub data_dir: String,
}

pub fn parse_build_tag(tag: &str) -> Option<u64> {
    tag.strip_prefix("build-")?.parse().ok()
}

fn release_prefix() -> String {
    format!("https://github.com/{REPO}/releases/download/")
}

pub fn is_allowed_url(url: &str) -> bool {
    url.starts_with(&release_prefix())
        && !url.contains("..")
        && !url.contains('@')
        && !url.contains('?')
        && url.ends_with("-setup.exe")
}

pub fn pick_newest(releases: &Value, current: u64) -> Option<UpdateInfo> {
    let mut best: Option<UpdateInfo> = None;
    for r in releases.as_array()? {
        if r.get("draft").and_then(|d| d.as_bool()).unwrap_or(false) {
            continue;
        }
        let tag = r.get("tag_name").and_then(|t| t.as_str()).unwrap_or("");
        let Some(build) = parse_build_tag(tag) else {
            continue;
        };
        if build <= current || best.as_ref().is_some_and(|b| b.build >= build) {
            continue;
        }
        let assets = r.get("assets").and_then(|a| a.as_array());
        let installer = assets.and_then(|a| {
            a.iter().find(|x| {
                x.get("name")
                    .and_then(|n| n.as_str())
                    .is_some_and(|n| n.ends_with("-setup.exe"))
            })
        });
        let Some(installer) = installer else { continue };
        let name = installer.get("name").and_then(|n| n.as_str()).unwrap_or("");
        // A release without its checksum file is never offered.
        let has_sum = assets.is_some_and(|a| {
            a.iter()
                .any(|x| x.get("name").and_then(|n| n.as_str()) == Some(&format!("{name}.sha256")))
        });
        let url = installer
            .get("browser_download_url")
            .and_then(|u| u.as_str())
            .unwrap_or("");
        if !has_sum || !is_allowed_url(url) {
            continue;
        }
        best = Some(UpdateInfo {
            build,
            tag: tag.to_string(),
            installer_url: url.to_string(),
            size: installer.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
            notes: r
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string(),
        });
    }
    best
}

pub fn parse_sha256(text: &str) -> Option<String> {
    let first = text.split_whitespace().next()?.to_ascii_lowercase();
    (first.len() == 64 && first.chars().all(|c| c.is_ascii_hexdigit())).then_some(first)
}

fn client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .user_agent(concat!("Kothok/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(900))
        .build()
        .map_err(|e| AppError::Network(e.to_string()))
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> Result<AppInfo, AppError> {
    use tauri::Manager;
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        build: current_build(),
        data_dir: app
            .path()
            .app_data_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn check_update() -> Result<Option<UpdateInfo>, AppError> {
    let build = current_build();
    if build == 0 {
        // Local/dev builds have no build number, so "newer" has no meaning.
        return Ok(None);
    }
    let resp = client()?
        .get(format!(
            "https://api.github.com/repos/{REPO}/releases?per_page=30"
        ))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::Network(e.without_url().to_string()))?;
    if !resp.status().is_success() {
        return Err(AppError::Provider(format!(
            "update server answered HTTP {}",
            resp.status().as_u16()
        )));
    }
    let v: Value = resp
        .json()
        .await
        .map_err(|e| AppError::BadResponse(e.to_string()))?;
    Ok(pick_newest(&v, build))
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    paths: State<'_, AppPaths>,
    installer_url: String,
) -> Result<(), AppError> {
    if !is_allowed_url(&installer_url) {
        return Err(AppError::Invalid("update address is not allowed".into()));
    }
    let file_name = installer_url.rsplit('/').next().unwrap_or("");
    if file_name.is_empty()
        || !file_name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(AppError::Invalid("unexpected installer name".into()));
    }
    let http = client()?;
    let map = |e: reqwest::Error| AppError::Network(e.without_url().to_string());

    let sum_text = http
        .get(format!("{installer_url}.sha256"))
        .send()
        .await
        .map_err(map)?
        .error_for_status()
        .map_err(map)?
        .text()
        .await
        .map_err(map)?;
    let expected = parse_sha256(&sum_text)
        .ok_or_else(|| AppError::BadResponse("the checksum file is invalid".into()))?;

    let mut resp = http
        .get(&installer_url)
        .send()
        .await
        .map_err(map)?
        .error_for_status()
        .map_err(map)?;
    let dest = paths.temp.join(file_name);
    let mut file = std::fs::File::create(&dest)?;
    let mut hasher = Sha256::new();
    let mut total: u64 = 0;
    while let Some(chunk) = resp.chunk().await.map_err(map)? {
        total += chunk.len() as u64;
        if total > MAX_INSTALLER_BYTES {
            drop(file);
            let _ = std::fs::remove_file(&dest);
            return Err(AppError::Invalid("installer is too large".into()));
        }
        hasher.update(&chunk);
        std::io::Write::write_all(&mut file, &chunk)?;
    }
    drop(file);
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected {
        let _ = std::fs::remove_file(&dest);
        return Err(AppError::BadResponse(
            "the downloaded installer failed its checksum and was discarded".into(),
        ));
    }
    std::process::Command::new(&dest).spawn()?;
    // Quit so the installer can replace the running program's files.
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn release(tag: &str, with_sum: bool) -> Value {
        let url =
            format!("https://github.com/{REPO}/releases/download/{tag}/Kothok_0.1.0_x64-setup.exe");
        let mut assets = vec![
            json!({"name":"Kothok_0.1.0_x64-setup.exe","browser_download_url":url,"size":1000}),
        ];
        if with_sum {
            assets.push(json!({"name":"Kothok_0.1.0_x64-setup.exe.sha256","browser_download_url":format!("{url}.sha256")}));
        }
        json!({"tag_name":tag,"name":format!("Kothok {tag}"),"draft":false,"assets":assets})
    }

    #[test]
    fn picks_highest_newer_build_with_checksum() {
        let v = json!([
            release("build-5", true),
            release("build-9", true),
            release("build-12", false),
            release("v0.1.0", true)
        ]);
        assert_eq!(pick_newest(&v, 5).map(|u| u.build), Some(9));
        assert_eq!(pick_newest(&v, 9), None);
    }

    #[test]
    fn draft_and_foreign_urls_are_ignored() {
        let mut d = release("build-20", true);
        d["draft"] = json!(true);
        let mut foreign = release("build-21", true);
        foreign["assets"][0]["browser_download_url"] =
            json!("https://evil.example/Kothok-setup.exe");
        assert_eq!(pick_newest(&json!([d, foreign]), 1), None);
    }

    #[test]
    fn url_and_checksum_rules() {
        assert!(is_allowed_url(&format!(
            "{}build-3/a-setup.exe",
            release_prefix()
        )));
        assert!(!is_allowed_url(
            "https://github.com/other/Kothok/releases/download/build-3/a-setup.exe"
        ));
        assert!(!is_allowed_url(&format!(
            "{}build-3/../x-setup.exe",
            release_prefix()
        )));
        assert!(!is_allowed_url(&format!(
            "{}build-3/a.exe",
            release_prefix()
        )));
        let h = "a".repeat(64);
        assert_eq!(parse_sha256(&format!("{h}  file.exe\n")), Some(h.clone()));
        assert_eq!(parse_sha256("zz"), None);
        assert_eq!(parse_build_tag("build-12"), Some(12));
        assert_eq!(parse_build_tag("v1"), None);
    }
}
