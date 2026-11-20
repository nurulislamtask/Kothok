//! A pool of API keys per provider. Calls try the available keys in order; a key that reports a
//! rate limit (or is rejected) is parked until it should work again, and the call moves on to the
//! next key. Key text stays in the OS credential store; only labels and timings are in SQLite.

use std::future::Future;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::db::Db;
use crate::error::AppError;
use crate::providers::{key_owner, ProviderRecord};

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/// Credential-store name for one extra key.
fn slot_name(owner: &str, id: i64) -> String {
    format!("{owner}:pool:{id}")
}

#[derive(Debug, Clone)]
struct Slot {
    id: i64,
    is_primary: bool,
    available: bool,
    wait_secs: i64,
}

fn ensure_primary(conn: &Connection, owner: &str) -> Result<(), AppError> {
    conn.execute(
        &format!(
            "INSERT OR IGNORE INTO key_pool (owner_id, label, is_primary, created_at)
             VALUES (?1, 'Main key', 1, {NOW})"
        ),
        [owner],
    )?;
    Ok(())
}

fn slots(conn: &Connection, owner: &str) -> Result<Vec<Slot>, AppError> {
    let mut st = conn.prepare(&format!(
        "SELECT id, is_primary,
                CASE WHEN cooldown_until IS NULL OR cooldown_until <= {NOW} THEN 0
                     ELSE CAST((julianday(cooldown_until) - julianday('now')) * 86400 AS INTEGER) + 1 END
         FROM key_pool WHERE owner_id = ?1 ORDER BY is_primary DESC, id"
    ))?;
    let rows = st
        .query_map([owner], |r| {
            let wait: i64 = r.get(2)?;
            Ok(Slot {
                id: r.get(0)?,
                is_primary: r.get::<_, i64>(1)? == 1,
                available: wait == 0,
                wait_secs: wait,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn secret(owner: &str, slot: &Slot) -> Result<Option<String>, AppError> {
    if slot.is_primary {
        crate::credentials::get(owner)
    } else {
        crate::credentials::get(&slot_name(owner, slot.id))
    }
}

fn mark_ok(db: &Db, id: i64) {
    if let Ok(c) = db.0.lock() {
        let _ = c.execute(
            "UPDATE key_pool SET uses = uses + 1, last_error = NULL WHERE id = ?1",
            [id],
        );
    }
}

fn mark_limited(db: &Db, id: i64, secs: u64, why: &str) {
    if let Ok(c) = db.0.lock() {
        let _ = c.execute(
            &format!(
                "UPDATE key_pool SET cooldown_until = strftime('%Y-%m-%dT%H:%M:%fZ','now', ?2),
                        last_error = ?3 WHERE id = ?1"
            ),
            params![id, format!("+{secs} seconds"), why],
        );
    }
}

/// Run `call` with each usable key in turn. A rate-limited or rejected key is parked and the
/// next one is tried; any other error is returned as it is. Providers without a key (local
/// servers) just run once with `None`.
pub async fn with_keys<T, F, Fut>(db: &Db, rec: &ProviderRecord, mut call: F) -> Result<T, AppError>
where
    F: FnMut(Option<String>) -> Fut,
    Fut: Future<Output = Result<T, AppError>>,
{
    let owner = key_owner(rec);
    let list = {
        let conn = db.0.lock().map_err(|_| AppError::Lock)?;
        if crate::credentials::get(&owner)?.is_some() {
            ensure_primary(&conn, &owner)?;
        }
        slots(&conn, &owner)?
    };
    if list.is_empty() {
        return call(None).await;
    }
    let mut last: Option<AppError> = None;
    let mut tried = 0;
    for slot in list.iter().filter(|s| s.available) {
        let Some(key) = secret(&owner, slot)? else {
            continue;
        };
        tried += 1;
        match call(Some(key)).await {
            Ok(v) => {
                mark_ok(db, slot.id);
                return Ok(v);
            }
            Err(AppError::Quota(secs)) => {
                mark_limited(db, slot.id, secs.unwrap_or(60), "limit reached");
                last = Some(AppError::Quota(secs));
            }
            Err(AppError::InvalidKey) => {
                // A rejected key will not fix itself soon; re-check it tomorrow.
                mark_limited(db, slot.id, 86_400, "key rejected");
                last = Some(AppError::InvalidKey);
            }
            Err(other) => return Err(other),
        }
    }
    if let Some(e) = last {
        return Err(e);
    }
    if tried == 0 {
        // Every key is parked: report the soonest time one comes back.
        let soonest = list.iter().map(|s| s.wait_secs).filter(|w| *w > 0).min();
        return Err(AppError::Quota(soonest.map(|s| s as u64)));
    }
    Err(AppError::NoProvider)
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolEntry {
    pub id: i64,
    pub label: String,
    pub primary: bool,
    /// "ok" or "limited".
    pub status: String,
    /// Seconds until the key is tried again (only when limited).
    pub retry_in_secs: Option<i64>,
    pub last_error: Option<String>,
    pub uses: i64,
}

fn owner_of(db: &Db, provider_id: &str) -> Result<String, AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let rec = crate::commands::providers::load_provider(&conn, provider_id)?;
    Ok(key_owner(&rec))
}

#[tauri::command]
pub fn pool_list(
    db: tauri::State<'_, Db>,
    provider_id: String,
) -> Result<Vec<PoolEntry>, AppError> {
    let owner = owner_of(&db, &provider_id)?;
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    if crate::credentials::get(&owner)?.is_some() {
        ensure_primary(&conn, &owner)?;
    }
    let mut st = conn.prepare(&format!(
        "SELECT id, label, is_primary, last_error, uses,
                CASE WHEN cooldown_until IS NULL OR cooldown_until <= {NOW} THEN NULL
                     ELSE CAST((julianday(cooldown_until) - julianday('now')) * 86400 AS INTEGER) + 1 END
         FROM key_pool WHERE owner_id = ?1 ORDER BY is_primary DESC, id"
    ))?;
    let rows = st
        .query_map([&owner], |r| {
            let wait: Option<i64> = r.get(5)?;
            Ok(PoolEntry {
                id: r.get(0)?,
                label: r.get(1)?,
                primary: r.get::<_, i64>(2)? == 1,
                status: if wait.is_some() { "limited" } else { "ok" }.into(),
                retry_in_secs: wait,
                last_error: r.get(3)?,
                uses: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn pool_add(
    db: tauri::State<'_, Db>,
    provider_id: String,
    label: String,
    api_key: String,
) -> Result<(), AppError> {
    let owner = owner_of(&db, &provider_id)?;
    let key = api_key.trim();
    let label = label.trim();
    if key.is_empty() || key.len() > 512 || key.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err(AppError::Invalid("the API key looks wrong".into()));
    }
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    if crate::credentials::get(&owner)?.is_none() {
        return Err(AppError::Invalid("add the main key first".into()));
    }
    ensure_primary(&conn, &owner)?;
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM key_pool WHERE owner_id = ?1",
        [&owner],
        |r| r.get(0),
    )?;
    if n >= 20 {
        return Err(AppError::Invalid("at most 20 keys per provider".into()));
    }
    let label = if label.is_empty() {
        format!("Account {}", n + 1)
    } else {
        label.chars().take(40).collect()
    };
    conn.execute(
        &format!("INSERT INTO key_pool (owner_id, label, is_primary, created_at) VALUES (?1, ?2, 0, {NOW})"),
        params![owner, label],
    )?;
    let id = conn.last_insert_rowid();
    if let Err(e) = crate::credentials::set(&slot_name(&owner, id), key) {
        let _ = conn.execute("DELETE FROM key_pool WHERE id = ?1", [id]);
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
pub fn pool_remove(db: tauri::State<'_, Db>, provider_id: String, id: i64) -> Result<(), AppError> {
    let owner = owner_of(&db, &provider_id)?;
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    let primary: Option<i64> = conn
        .query_row(
            "SELECT is_primary FROM key_pool WHERE id = ?1 AND owner_id = ?2",
            params![id, owner],
            |r| r.get(0),
        )
        .optional()?;
    match primary {
        None => Err(AppError::Invalid("key not found".into())),
        Some(1) => Err(AppError::Invalid(
            "the main key is changed or removed in its provider's edit form".into(),
        )),
        Some(_) => {
            crate::credentials::delete(&slot_name(&owner, id))?;
            conn.execute("DELETE FROM key_pool WHERE id = ?1", [id])?;
            Ok(())
        }
    }
}

/// Forget the cooldown of one key ("I know the limit has reset").
#[tauri::command]
pub fn pool_reset(db: tauri::State<'_, Db>, provider_id: String, id: i64) -> Result<(), AppError> {
    let owner = owner_of(&db, &provider_id)?;
    let conn = db.0.lock().map_err(|_| AppError::Lock)?;
    conn.execute(
        "UPDATE key_pool SET cooldown_until = NULL, last_error = NULL WHERE id = ?1 AND owner_id = ?2",
        params![id, owner],
    )?;
    Ok(())
}

/// Called when a provider is deleted so no key text is left behind.
pub fn forget_owner(conn: &Connection, owner: &str) {
    if let Ok(mut st) =
        conn.prepare("SELECT id FROM key_pool WHERE owner_id = ?1 AND is_primary = 0")
    {
        if let Ok(ids) = st.query_map([owner], |r| r.get::<_, i64>(0)) {
            for id in ids.flatten() {
                let _ = crate::credentials::delete(&slot_name(owner, id));
            }
        }
    }
    let _ = conn.execute("DELETE FROM key_pool WHERE owner_id = ?1", [owner]);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut c).unwrap();
        c
    }

    #[test]
    fn parked_keys_are_skipped_until_their_time() {
        let c = mem();
        ensure_primary(&c, "p").unwrap();
        ensure_primary(&c, "p").unwrap(); // idempotent
        c.execute(
            "INSERT INTO key_pool (owner_id,label,is_primary,created_at) VALUES ('p','B',0,'x')",
            [],
        )
        .unwrap();
        assert_eq!(slots(&c, "p").unwrap().len(), 2);
        assert!(slots(&c, "p").unwrap().iter().all(|s| s.available));
        c.execute(
            "UPDATE key_pool SET cooldown_until = strftime('%Y-%m-%dT%H:%M:%fZ','now','+120 seconds') WHERE is_primary = 1",
            [],
        )
        .unwrap();
        let s = slots(&c, "p").unwrap();
        assert!(s[0].is_primary && !s[0].available && s[0].wait_secs > 100);
        assert!(s[1].available);
        c.execute(
            "UPDATE key_pool SET cooldown_until = strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 seconds') WHERE is_primary = 1",
            [],
        )
        .unwrap();
        assert!(slots(&c, "p").unwrap().iter().all(|s| s.available));
    }
}
