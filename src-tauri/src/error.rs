use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// Every backend failure that can reach the UI. The frontend maps `code` to a
/// translated message (`errors.<code>` in the i18n files), so codes are stable.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("internal state lock poisoned")]
    Lock,
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Db(_) => "db_error",
            AppError::Io(_) => "io_error",
            AppError::Lock => "internal",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut st = serializer.serialize_struct("AppError", 2)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}
