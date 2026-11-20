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
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("credential store error: {0}")]
    Credential(String),
    #[error("provider not found")]
    ProviderNotFound,
    #[error("no provider is configured")]
    NoProvider,
    #[error("no model selected")]
    NoModel,
    #[error("API key missing or rejected")]
    InvalidKey,
    /// Rate or quota limit; the number is how many seconds the provider asked us to wait, if known.
    #[error("quota or rate limit exceeded")]
    Quota(Option<u64>),
    #[error("network error: {0}")]
    Network(String),
    #[error("provider error: {0}")]
    Provider(String),
    #[error("unexpected provider response: {0}")]
    BadResponse(String),
    #[error("the model returned an empty reply")]
    EmptyReply,
    #[error("{0} may incur charges and needs confirmation")]
    NeedsConfirmation(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Db(_) => "db_error",
            AppError::Io(_) => "io_error",
            AppError::Lock => "internal",
            AppError::Invalid(_) => "invalid_input",
            AppError::Credential(_) => "credential_error",
            AppError::ProviderNotFound => "provider_not_found",
            AppError::NoProvider => "no_provider",
            AppError::NoModel => "no_model",
            AppError::InvalidKey => "invalid_key",
            AppError::Quota(_) => "quota_exceeded",
            AppError::Network(_) => "network_error",
            AppError::Provider(_) => "provider_error",
            AppError::BadResponse(_) => "bad_response",
            AppError::EmptyReply => "empty_reply",
            AppError::NeedsConfirmation(_) => "needs_confirmation",
        }
    }

    /// Extra context the UI may show next to the translated message.
    pub fn detail(&self) -> Option<String> {
        match self {
            AppError::Invalid(m)
            | AppError::Credential(m)
            | AppError::Network(m)
            | AppError::Provider(m)
            | AppError::BadResponse(m)
            | AppError::NeedsConfirmation(m) => Some(m.clone()),
            _ => None,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut st = serializer.serialize_struct("AppError", 3)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &self.to_string())?;
        st.serialize_field("detail", &self.detail())?;
        st.end()
    }
}
