//! Session-scoped API keys that never reach disk.
//!
//! The default credential path persists a key into the owner-only provider
//! store at `$JCODE_HOME/config/jcode/<provider>.env`. An embedding client may
//! instead hold a key for one session only. Such a key is set through
//! `set_ephemeral_api_key` on the harness API, lives in this process's memory,
//! and is dropped when the session ends or the process exits.
//!
//! [`load_api_key_from_env_or_config`](crate::load_api_key_from_env_or_config)
//! prefers an ephemeral key over the provider file, so a stale file cannot
//! silently win over the value the client just supplied. Clearing a key never
//! deletes a file, and nothing here writes to disk.

use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};

use jcode_provider_metadata::is_safe_env_key_name;

/// One in-memory key: which session supplied it, and the value.
#[derive(Debug, Clone)]
struct EphemeralKey {
    session_id: String,
    value: String,
}

/// Env-key → key. One value per provider key, the most recent writer wins,
/// because a provider reads its key by variable name and holds no session id.
static EPHEMERAL_KEYS: LazyLock<RwLock<HashMap<String, EphemeralKey>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

fn registry() -> std::sync::RwLockReadGuard<'static, HashMap<String, EphemeralKey>> {
    EPHEMERAL_KEYS
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn registry_mut() -> std::sync::RwLockWriteGuard<'static, HashMap<String, EphemeralKey>> {
    EPHEMERAL_KEYS
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Validate a value the same way the persisted provider store does.
fn validate_value(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.trim() != value || value.contains(['\n', '\r', '\0']) {
        return Err("api_key must be a non-empty, trimmed, non-NUL single line".to_string());
    }
    Ok(())
}

/// Hold `value` for `env_key` in memory, attributed to `session_id`.
///
/// The registry holds one value per variable, so a write from another session
/// replaces the value the previous session held and both sessions then read the
/// new one. Only clearing is session-scoped; see the module comment above
/// `EPHEMERAL_KEYS`.
pub fn set(session_id: &str, env_key: &str, value: &str) -> Result<(), String> {
    if session_id.trim().is_empty() {
        return Err("session_id must be non-empty".to_string());
    }
    if !is_safe_env_key_name(env_key) {
        return Err(format!("invalid API key variable name '{env_key}'"));
    }
    validate_value(value)?;
    registry_mut().insert(
        env_key.to_string(),
        EphemeralKey {
            session_id: session_id.to_string(),
            value: value.to_string(),
        },
    );
    Ok(())
}

/// The in-memory key for `env_key`, if one is held.
///
/// A provider resolves its key by variable name and carries no session id, so
/// this lookup cannot be scoped to the session that supplied the value.
pub fn lookup(env_key: &str) -> Option<String> {
    registry().get(env_key).map(|key| key.value.clone())
}

/// Drop the key for `env_key` when `session_id` owns it. Returns whether a key
/// was removed. A key set by another session is left alone.
pub fn clear(session_id: &str, env_key: &str) -> bool {
    let mut keys = registry_mut();
    match keys.get(env_key) {
        Some(key) if key.session_id == session_id => {
            keys.remove(env_key);
            true
        }
        _ => false,
    }
}

/// Drop every key `session_id` holds, for example when its session ends.
pub fn clear_session(session_id: &str) -> usize {
    let mut keys = registry_mut();
    let before = keys.len();
    keys.retain(|_, key| key.session_id != session_id);
    before - keys.len()
}

/// Variable names currently held in memory. Names only, never values, so this
/// is safe for diagnostics and logs.
pub fn held_env_keys() -> Vec<String> {
    let mut names: Vec<String> = registry().keys().cloned().collect();
    names.sort();
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clear_all() {
        registry_mut().clear();
    }

    #[test]
    fn holds_a_value_in_memory_and_returns_it() {
        clear_all();
        set("session-1", "ANTHROPIC_API_KEY", "sk-synthetic").expect("set");
        assert_eq!(lookup("ANTHROPIC_API_KEY").as_deref(), Some("sk-synthetic"));
        assert_eq!(held_env_keys(), vec!["ANTHROPIC_API_KEY".to_string()]);
    }

    #[test]
    fn rejects_values_the_persisted_store_would_reject() {
        clear_all();
        assert!(set("session-1", "ANTHROPIC_API_KEY", "  padded").is_err());
        assert!(set("session-1", "ANTHROPIC_API_KEY", "").is_err());
        assert!(set("session-1", "ANTHROPIC_API_KEY", "two\nlines").is_err());
        assert!(set("session-1", "ANTHROPIC_API_KEY", "has\0nul").is_err());
        assert!(set("", "ANTHROPIC_API_KEY", "sk-synthetic").is_err());
        assert!(set("session-1", "BAD=KEY", "sk-synthetic").is_err());
        assert!(lookup("ANTHROPIC_API_KEY").is_none());
    }

    #[test]
    fn another_session_cannot_clear_a_held_key() {
        clear_all();
        set("session-1", "ANTHROPIC_API_KEY", "sk-synthetic").expect("set");
        assert!(!clear("session-2", "ANTHROPIC_API_KEY"));
        assert!(lookup("ANTHROPIC_API_KEY").is_some());
        assert!(clear("session-1", "ANTHROPIC_API_KEY"));
        assert!(lookup("ANTHROPIC_API_KEY").is_none());
    }

    #[test]
    fn clearing_a_session_drops_only_its_keys() {
        clear_all();
        set("session-1", "ANTHROPIC_API_KEY", "sk-one").expect("set");
        set("session-2", "OPENAI_API_KEY", "sk-two").expect("set");
        assert_eq!(clear_session("session-1"), 1);
        assert!(lookup("ANTHROPIC_API_KEY").is_none());
        assert_eq!(lookup("OPENAI_API_KEY").as_deref(), Some("sk-two"));
        clear_all();
    }

    #[test]
    fn the_most_recent_writer_wins() {
        clear_all();
        set("session-1", "ANTHROPIC_API_KEY", "sk-first").expect("set");
        set("session-2", "ANTHROPIC_API_KEY", "sk-second").expect("set");
        assert_eq!(lookup("ANTHROPIC_API_KEY").as_deref(), Some("sk-second"));
        clear_all();
    }
}
