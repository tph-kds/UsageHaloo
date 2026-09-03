//! Secret handling: aliases in the database, values in the OS keychain.
//!
//! Non-negotiable rule: **no secret keys in SQLite**. The database stores a
//! `secret_alias` only (e.g. `openrouter:management-key`). This crate resolves
//! aliases to values at connector runtime.
//!
//! Production backends (per platform):
//! - Windows: Credential Manager (via the `keyring` crate, `windows-native`)
//! - macOS: Keychain (via the `keyring` crate, `apple-native`)
//! - Linux: Secret Service / KWallet (via the `keyring` crate)
//!
//! The `keyring` integration lives behind a `os-keychain` cargo feature so the
//! core workspace builds without platform SDKs. Until the feature is enabled,
//! [`EnvSecretStore`] resolves `ALIAS` → env var `USAGEHALO_SECRET_<ALIAS>`
//! (uppercased, non-alphanumeric → `_`), which keeps local dev and CI working
//! without ever persisting a secret to disk or SQLite.

use std::collections::HashMap;

/// Error type for secret resolution. Values are never included in messages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretError {
    /// No value configured for this alias.
    NotFound(String),
    /// A value exists but cannot be used (locked keychain, denied access…).
    Unavailable(String),
}

impl std::fmt::Display for SecretError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(alias) => write!(f, "no secret configured for alias '{alias}'"),
            Self::Unavailable(alias) => write!(f, "secret unavailable for alias '{alias}'"),
        }
    }
}

impl std::error::Error for SecretError {}

pub type SecretResult = Result<String, SecretError>;

/// Minimal secret-store contract for connectors.
pub trait SecretStore: Send + Sync {
    fn get(&self, alias: &str) -> SecretResult;
    /// Presence check that never returns the value (safe for logging/UI).
    fn has(&self, alias: &str) -> bool {
        self.get(alias).is_ok()
    }
}

/// Env-backed store for development and CI. Never logs values.
#[derive(Debug, Default)]
pub struct EnvSecretStore {
    overrides: HashMap<String, String>,
}

impl EnvSecretStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Explicit in-memory override (tests only — never from disk).
    pub fn with_override(mut self, alias: &str, value: &str) -> Self {
        self.overrides.insert(alias.to_string(), value.to_string());
        self
    }

    pub fn env_name(alias: &str) -> String {
        let mut out = String::from("USAGEHALO_SECRET_");
        for c in alias.chars() {
            if c.is_ascii_alphanumeric() {
                out.push(c.to_ascii_uppercase());
            } else {
                out.push('_');
            }
        }
        out
    }
}

impl SecretStore for EnvSecretStore {
    fn get(&self, alias: &str) -> SecretResult {
        if let Some(v) = self.overrides.get(alias) {
            if !v.trim().is_empty() {
                return Ok(v.clone());
            }
        }
        let name = Self::env_name(alias);
        match std::env::var(&name) {
            Ok(v) if !v.trim().is_empty() => Ok(v),
            _ => Err(SecretError::NotFound(alias.to_string())),
        }
    }
}

/// Well-known aliases. Connectors must use these, never ad-hoc key names.
pub mod aliases {
    pub const OPENROUTER_MANAGEMENT: &str = "openrouter:management-key";
    pub const OPENAI_ADMIN: &str = "openai:admin-key";
    pub const ANTHROPIC_ADMIN: &str = "anthropic:admin-key";
    pub const CURSOR_ADMIN: &str = "cursor:admin-key";
    pub const MISTRAL_ADMIN: &str = "mistral:admin-key";
}

/// OS-native credential vault backend (`os-keychain` feature).
///
/// One entry per alias: service `dev.usagehalo.app`, account = alias.
/// Values never touch SQLite, logs, or error messages.
#[cfg(feature = "os-keychain")]
pub mod keychain {
    use super::{SecretError, SecretResult, SecretStore};

    pub const SERVICE: &str = "dev.usagehalo.app";

    #[derive(Debug, Clone)]
    pub struct OsKeychainStore {
        service: String,
    }

    impl OsKeychainStore {
        pub fn new() -> Self {
            Self {
                service: SERVICE.to_string(),
            }
        }

        /// Test/enterprise override for the service namespace.
        pub fn with_service(service: impl Into<String>) -> Self {
            Self {
                service: service.into(),
            }
        }

        pub fn set(&self, alias: &str, value: &str) -> Result<(), SecretError> {
            let entry = keyring::Entry::new(&self.service, alias)
                .map_err(|_| SecretError::Unavailable(alias.into()))?;
            entry
                .set_password(value)
                .map_err(|_| SecretError::Unavailable(alias.into()))
        }

        pub fn delete(&self, alias: &str) -> Result<(), SecretError> {
            let entry = keyring::Entry::new(&self.service, alias)
                .map_err(|_| SecretError::Unavailable(alias.into()))?;
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err(SecretError::Unavailable(alias.into())),
            }
        }
    }

    impl Default for OsKeychainStore {
        fn default() -> Self {
            Self::new()
        }
    }

    impl SecretStore for OsKeychainStore {
        fn get(&self, alias: &str) -> SecretResult {
            let entry = keyring::Entry::new(&self.service, alias)
                .map_err(|_| SecretError::Unavailable(alias.into()))?;
            entry.get_password().map_err(|err| match err {
                keyring::Error::NoEntry => SecretError::NotFound(alias.into()),
                _ => SecretError::Unavailable(alias.into()),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_alias_is_not_found_without_leaking() {
        let store = EnvSecretStore::new();
        let err = store.get("openrouter:management-key").unwrap_err();
        assert_eq!(
            err,
            SecretError::NotFound("openrouter:management-key".into())
        );
        assert!(!format!("{err}").contains("sk-"));
    }

    #[test]
    fn override_resolves_and_presence_check_holds() {
        let store = EnvSecretStore::new().with_override("demo:alias", "s3cr3t");
        assert!(store.has("demo:alias"));
        assert_eq!(store.get("demo:alias").unwrap(), "s3cr3t");
        assert!(!store.has("demo:missing"));
    }

    #[test]
    fn env_name_mapping_is_stable() {
        assert_eq!(
            EnvSecretStore::env_name("openrouter:management-key"),
            "USAGEHALO_SECRET_OPENROUTER_MANAGEMENT_KEY"
        );
    }

    /// OS-keychain round-trip (set -> get -> delete). Skips honestly when the
    /// platform vault is unavailable (locked store, headless CI without a
    /// Secret Service); a value mismatch still fails loudly.
    #[cfg(feature = "os-keychain")]
    #[test]
    fn os_keychain_round_trip() {
        use super::keychain::OsKeychainStore;
        let store = OsKeychainStore::with_service("dev.usagehalo.app.test");
        let alias = "round-trip-probe";
        if store.set(alias, "probe-value-1").is_err() {
            eprintln!("SKIP: no usable OS keychain in this environment");
            return;
        }
        let got = store.get(alias).expect("just-stored value must read back");
        assert_eq!(got, "probe-value-1");
        store.delete(alias).expect("cleanup must succeed");
        assert!(matches!(
            store.get(alias),
            Err(super::SecretError::NotFound(_))
        ));
    }
}
