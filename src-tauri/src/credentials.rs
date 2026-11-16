//! API keys live only in the OS credential store (Windows Credential Manager).
//! They are never written to SQLite, logs, or sent back to the frontend.

use keyring::Entry;

use crate::error::AppError;

const SERVICE: &str = "kothok";

fn entry(provider_id: &str) -> Result<Entry, AppError> {
    Entry::new(SERVICE, &format!("provider:{provider_id}"))
        .map_err(|e| AppError::Credential(e.to_string()))
}

pub fn set(provider_id: &str, key: &str) -> Result<(), AppError> {
    entry(provider_id)?
        .set_password(key)
        .map_err(|e| AppError::Credential(e.to_string()))
}

pub fn get(provider_id: &str) -> Result<Option<String>, AppError> {
    match entry(provider_id)?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Credential(e.to_string())),
    }
}

pub fn delete(provider_id: &str) -> Result<(), AppError> {
    match entry(provider_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Credential(e.to_string())),
    }
}
