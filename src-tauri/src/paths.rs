//! App-owned folders. Everything the app writes lives under the OS app-data
//! directory; the frontend only ever sees relative names, never absolute paths
//! that it could redirect elsewhere.

use std::path::{Component, Path, PathBuf};

use crate::error::AppError;

#[derive(Clone, Clone)]
pub struct AppPaths {
    pub media: PathBuf,
    pub tools: PathBuf,
    pub temp: PathBuf,
}

impl AppPaths {
    pub fn new(data: &Path) -> Result<Self, AppError> {
        let p = AppPaths {
            media: data.join("media"),
            tools: data.join("tools"),
            temp: data.join("temp"),
        };
        std::fs::create_dir_all(&p.media)?;
        std::fs::create_dir_all(&p.tools)?;
        // Temporary files never survive a restart.
        let _ = std::fs::remove_dir_all(&p.temp);
        std::fs::create_dir_all(&p.temp)?;
        Ok(p)
    }

    /// Resolve a name previously returned by `new_media_name` to a path inside the media folder.
    pub fn media_path(&self, rel: &str) -> Result<PathBuf, AppError> {
        let rel_path = Path::new(rel);
        let ok = !rel.is_empty()
            && !rel.contains(':')
            && rel_path
                .components()
                .all(|c| matches!(c, Component::Normal(_)));
        if !ok {
            return Err(AppError::Invalid("invalid media path".into()));
        }
        Ok(self.media.join(rel_path))
    }
}

/// Unpredictable, collision-resistant file name using std's randomly seeded hasher.
pub fn random_stem() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut h = RandomState::new().build_hasher();
    h.write_u128(nanos);
    format!("{:016x}{:08x}", h.finish(), (nanos & 0xffff_ffff) as u32)
}

pub fn clean_ext(ext: &str) -> Result<String, AppError> {
    let e = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    if e.is_empty() || e.len() > 5 || !e.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::Invalid("invalid file extension".into()));
    }
    Ok(e)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths() -> AppPaths {
        AppPaths {
            media: PathBuf::from("/m"),
            tools: PathBuf::from("/t"),
            temp: PathBuf::from("/x"),
        }
    }

    #[test]
    fn media_path_rejects_escapes() {
        let p = paths();
        assert!(p.media_path("abc.png").is_ok());
        assert!(p.media_path("../secret").is_err());
        assert!(p.media_path("/etc/passwd").is_err());
        assert!(p.media_path("a/../../b").is_err());
        assert!(p.media_path("C:\\Windows\\x").is_err());
        assert!(p.media_path("").is_err());
    }

    #[test]
    fn ext_and_stem() {
        assert_eq!(clean_ext(".PNG").unwrap(), "png");
        assert!(clean_ext("p/g").is_err());
        assert!(clean_ext("toolongext").is_err());
        assert_ne!(random_stem(), random_stem());
    }
}
