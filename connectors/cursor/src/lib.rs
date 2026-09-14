use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use std::path::{Path, PathBuf};
use usage_halo_core::source::{
    ObservationStatus, ProviderAdapter, ProviderDiagnosis, ProviderIdentity,
    ProviderSnapshot, SourceDescriptor, SourceFidelity, SourceKind,
};

// ---------------------------------------------------------------------------
// Cursor local-state adapter (Phase B3 unit 1). Observed real state 2026-09-14:
// %APPDATA%/Cursor/User/globalStorage/state.vscdb holds identity hints +
// token references but ZERO usage numbers; quota/billing/activity are
// UNSUPPORTED from local state (team admin API path only, no key here).
// Token VALUES are never read: only cursorAuth/cachedEmail, by exact key.
// ---------------------------------------------------------------------------

const PROVIDER_ID: &str = "cursor";
const SOURCE_ID: &str = "local-state";
const EMAIL_KEY: &str = "cursorAuth/cachedEmail";

fn read_options(db: &Path) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(db)
        // read_only takes shared locks, so WAL readers never block the writer.
        // busy_timeout ~2s + one retry on locked: Cursor may hold a write lock
        // mid-flush. NEVER immutable=1 (the DB changes under us) and NEVER
        // write: this adapter is a read-only observer.
        .read_only(true)
        .busy_timeout(std::time::Duration::from_secs(2))
}

async fn query_cached_email(db: &Path) -> Result<Option<String>, sqlx::Error> {
    use sqlx::Connection as _;
    let options = read_options(db);
    let mut conn = SqliteConnection::connect_with(&options).await?;
    // Exact-key select only: never SELECT * and never token keys.
    let value: Option<String> =
        sqlx::query_scalar("SELECT value FROM ItemTable WHERE key = ?")
            .bind(EMAIL_KEY)
            .fetch_optional(&mut conn)
            .await?;
    Ok(value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty()))
}

fn is_locked_err(e: &sqlx::Error) -> bool {
    let s = e.to_string().to_lowercase();
    s.contains("locked") || s.contains("busy")
}

async fn read_cached_email(db: &Path) -> Option<String> {
    match query_cached_email(db).await {
        Ok(v) => v,
        Err(e) if is_locked_err(&e) => {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            query_cached_email(db).await.unwrap_or(None)
        }
        Err(_) => None,
    }
}

fn file_modified(path: &Path) -> Option<DateTime<Utc>> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()
        .map(DateTime::<Utc>::from)
}

struct SnapshotParts {
    now: DateTime<Utc>,
    status: ObservationStatus,
    message: Option<String>,
    retry_at: Option<DateTime<Utc>>,
    account_key: Option<String>,
    observed_at: Option<DateTime<Utc>>,
}

fn base_snapshot(p: SnapshotParts) -> ProviderSnapshot {
    ProviderSnapshot {
        provider_id: PROVIDER_ID.into(),
        account_key: p.account_key,
        account_label: None,
        collected_at: p.now,
        last_successful_at: None,
        observed_at: p.observed_at,
        headline_metric_id: None,
        capabilities: vec!["detection".into()],
        active_source_id: Some(SOURCE_ID.into()),
        windows: vec![],
        activity_state: None,
        activity_observed_at: None,
        activity_source_id: None,
        health_state: p.status,
        health_message: p.message,
        retry_at: p.retry_at,
    }
}

// Diagnostics carry presence/age, never identifiers or secrets.
pub fn diagnosis_line(
    detected: bool,
    signed_in: bool,
    db_age_s: Option<i64>,
    status: ObservationStatus,
    windows: usize,
) -> String {
    format!(
        "cursor detected={detected} signed_in={signed_in} db_age_s={} status={status:?} windows={windows} sources=[local-state]",
        db_age_s.map(|v| v.to_string()).unwrap_or_else(|| "none".into()),
    )
}

#[derive(Default)]
pub struct CursorAdapter {
    expected_account: Option<String>,
    db_path_override: Option<PathBuf>,
    path_dirs_override: Option<Vec<PathBuf>>,
}

impl CursorAdapter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_expected_account(mut self, key: impl Into<String>) -> Self {
        self.expected_account = Some(key.into());
        self
    }

    pub fn with_db_path(mut self, path: PathBuf) -> Self {
        self.db_path_override = Some(path);
        self
    }

    pub fn with_path_dirs(mut self, dirs: Vec<PathBuf>) -> Self {
        self.path_dirs_override = Some(dirs);
        self
    }

    fn db_path(&self) -> Option<PathBuf> {
        if let Some(p) = self.db_path_override.clone() {
            return Some(p);
        }
        // Only the observed APPDATA layout is supported; nothing invented.
        std::env::var_os("APPDATA").map(|base| {
            PathBuf::from(base)
                .join("Cursor")
                .join("User")
                .join("globalStorage")
                .join("state.vscdb")
        })
    }

    fn cli_resolvable(&self) -> bool {
        let dirs: Vec<PathBuf> = match self.path_dirs_override.clone() {
            Some(d) => d,
            None => std::env::var_os("PATH")
                .map(|p| std::env::split_paths(&p).collect())
                .unwrap_or_default(),
        };
        // PATH lookup only, never executed (no subprocess in this unit).
        let names: &[&str] = if cfg!(windows) {
            &["cursor.cmd", "cursor.exe", "cursor"]
        } else {
            &["cursor"]
        };
        dirs.iter()
            .any(|d| names.iter().any(|n| d.join(n).exists()))
    }

    async fn cached_email(&self) -> Option<String> {
        let path = self.db_path()?;
        if !path.exists() {
            return None;
        }
        read_cached_email(&path).await
    }

    fn db_age_s(&self, now: DateTime<Utc>) -> Option<i64> {
        let modified = file_modified(self.db_path()?.as_path())?;
        Some(now.signed_duration_since(modified).num_seconds().max(0))
    }

    async fn collect_internal(&self, now: DateTime<Utc>) -> ProviderSnapshot {
        let email = self.cached_email().await;
        if let Some(expected) = self.expected_account.as_deref() {
            if email.as_deref() != Some(expected) {
                return base_snapshot(SnapshotParts {
                    now,
                    status: ObservationStatus::Error,
                    message: Some(
                        "account unverified: local state identity does not match \
                         the expected account; windows withheld"
                            .into(),
                    ),
                    retry_at: None,
                    account_key: None,
                    observed_at: None,
                });
            }
        }
        match email {
            Some(account_key) => base_snapshot(SnapshotParts {
                now,
                status: ObservationStatus::Unsupported,
                message: Some(
                    "no verified local usage source; usage requires the team \
                     admin API (unconfigured); local state holds identity only"
                        .into(),
                ),
                retry_at: None,
                account_key: Some(account_key),
                observed_at: None,
            }),
            None => base_snapshot(SnapshotParts {
                now,
                status: ObservationStatus::NeedsAuth,
                message: Some("not signed in to Cursor".into()),
                retry_at: None,
                account_key: None,
                observed_at: None,
            }),
        }
    }
}

#[async_trait]
impl ProviderAdapter for CursorAdapter {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    fn source_descriptors(&self) -> Vec<SourceDescriptor> {
        vec![SourceDescriptor {
            source_id: SOURCE_ID.into(),
            provider_id: PROVIDER_ID.into(),
            kind: SourceKind::LocalDb,
            fidelity: SourceFidelity::FirstPartyLocal,
            label: "Cursor local state DB (state.vscdb ItemTable): \
                    detection+identity only, never usage"
                .into(),
            requires_local_access: true,
        }]
    }

    fn headline_metric_id(&self) -> Option<String> {
        None
    }

    async fn detect(&self) -> usage_halo_core::Result<bool> {
        if let Some(path) = self.db_path() {
            if path.exists() {
                return Ok(true);
            }
        }
        Ok(self.cli_resolvable())
    }

    async fn get_capabilities(&self) -> usage_halo_core::Result<Vec<String>> {
        Ok(vec!["detection".into()])
    }

    async fn get_identity(&self) -> usage_halo_core::Result<ProviderIdentity> {
        Ok(ProviderIdentity {
            account_key: self.cached_email().await,
            account_label: None,
        })
    }

    async fn collect(&self) -> usage_halo_core::Result<ProviderSnapshot> {
        Ok(self.collect_internal(Utc::now()).await)
    }

    async fn diagnose(&self) -> usage_halo_core::Result<ProviderDiagnosis> {
        let now = Utc::now();
        let snap = self.collect_internal(now).await;
        let detected = self.detect().await.unwrap_or(false);
        let signed_in = snap.account_key.is_some();
        let line = diagnosis_line(
            detected,
            signed_in,
            self.db_age_s(now),
            snap.health_state,
            snap.windows.len(),
        );
        Ok(ProviderDiagnosis {
            status: snap.health_state,
            message: Some(line),
            retry_at: snap.retry_at,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqliteJournalMode;
    use usage_halo_core::source::honest_fraction;

    fn scoped_db(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cursor-adapter-test-{}-{tag}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir.join("state.vscdb")
    }

    fn remove_db_files(db: &Path) {
        let _ = std::fs::remove_file(db);
        for suffix in ["-wal", "-shm", "-journal"] {
            let _ = std::fs::remove_file(PathBuf::from(format!(
                "{}{suffix}",
                db.display()
            )));
        }
    }

    async fn create_state_db(db: &Path, rows: &[(&str, &str)], wal: bool) {
        use sqlx::Connection as _;
        remove_db_files(db);
        let mut options = SqliteConnectOptions::new()
            .filename(db)
            .create_if_missing(true);
        if wal {
            options = options.journal_mode(SqliteJournalMode::Wal);
        }
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("create test db");
        sqlx::query("CREATE TABLE ItemTable(key TEXT PRIMARY KEY, value TEXT)")
            .execute(&mut conn)
            .await
            .expect("create ItemTable");
        for (k, v) in rows {
            sqlx::query("INSERT INTO ItemTable(key, value) VALUES (?, ?)")
                .bind(*k)
                .bind(*v)
                .execute(&mut conn)
                .await
                .expect("insert test row");
        }
    }

    fn signed_in_rows() -> Vec<(&'static str, &'static str)> {
        vec![
            ("cursorAuth/accessToken", "redacted-token-ref"),
            ("cursorAuth/cachedEmail", "test-user@example.invalid"),
            ("cursorAuth/cachedSignUpType", "redacted"),
            ("cursorAuth/claudeKey", "redacted-token-ref"),
            ("cursorAuth/refreshToken", "redacted-token-ref"),
            ("cursorAuth/stripeMembershipType", "redacted"),
        ]
    }

    #[tokio::test]
    async fn signed_in_identity_returns_email_key() {
        let db = scoped_db("signed-in");
        create_state_db(&db, &signed_in_rows(), false).await;
        let adapter = CursorAdapter::new().with_db_path(db.clone());
        assert!(adapter.detect().await.unwrap());
        let identity = adapter.get_identity().await.unwrap();
        assert_eq!(
            identity.account_key.as_deref(),
            Some("test-user@example.invalid")
        );
        remove_db_files(&db);
    }

    #[tokio::test]
    async fn signed_in_collect_is_unsupported_identity_only() {
        let db = scoped_db("unsupported");
        create_state_db(&db, &signed_in_rows(), false).await;
        let adapter = CursorAdapter::new().with_db_path(db.clone());
        let snap = adapter.collect().await.unwrap();
        assert_eq!(snap.health_state, ObservationStatus::Unsupported);
        assert!(snap.windows.is_empty());
        assert_eq!(snap.headline_metric_id, None);
        assert_eq!(snap.capabilities, vec!["detection".to_string()]);
        assert!(
            snap.health_message
                .as_deref()
                .unwrap_or_default()
                .contains("team admin API")
        );
        remove_db_files(&db);
    }

    #[tokio::test]
    async fn logged_out_copy_needs_auth() {
        let db = scoped_db("logged-out");
        create_state_db(&db, &signed_in_rows(), false).await;
        {
            use sqlx::Connection as _;
            let options = SqliteConnectOptions::new().filename(&db);
            let mut conn = SqliteConnection::connect_with(&options)
                .await
                .expect("open test db");
            sqlx::query("DELETE FROM ItemTable")
                .execute(&mut conn)
                .await
                .expect("delete keys");
        }
        let adapter = CursorAdapter::new().with_db_path(db.clone());
        let identity = adapter.get_identity().await.unwrap();
        assert_eq!(identity.account_key, None);
        let snap = adapter.collect().await.unwrap();
        assert_eq!(snap.health_state, ObservationStatus::NeedsAuth);
        assert!(snap.windows.is_empty());
        remove_db_files(&db);
    }

    #[tokio::test]
    async fn expected_account_mismatch_withholds() {
        let db = scoped_db("mismatch");
        create_state_db(&db, &signed_in_rows(), false).await;
        let adapter = CursorAdapter::new()
            .with_db_path(db.clone())
            .with_expected_account("someone-else@example.invalid");
        let snap = adapter.collect().await.unwrap();
        assert_eq!(snap.health_state, ObservationStatus::Error);
        assert!(snap.windows.is_empty());
        assert_eq!(snap.account_key, None);
        remove_db_files(&db);
    }

    #[tokio::test]
    async fn expected_account_match_reports_unsupported() {
        let db = scoped_db("match");
        create_state_db(&db, &signed_in_rows(), false).await;
        let adapter = CursorAdapter::new()
            .with_db_path(db.clone())
            .with_expected_account("test-user@example.invalid");
        let snap = adapter.collect().await.unwrap();
        assert_eq!(snap.health_state, ObservationStatus::Unsupported);
        remove_db_files(&db);
    }

    #[tokio::test]
    async fn wal_uncheckpointed_rows_are_visible() {
        let db = scoped_db("wal");
        create_state_db(&db, &signed_in_rows(), true).await;
        let wal = PathBuf::from(format!("{}-wal", db.display()));
        assert!(wal.exists(), "expected uncheckpointed -wal file");
        let adapter = CursorAdapter::new().with_db_path(db.clone());
        let identity = adapter.get_identity().await.unwrap();
        assert_eq!(
            identity.account_key.as_deref(),
            Some("test-user@example.invalid"),
            "committed-but-uncheckpointed WAL rows must be visible to the read path"
        );
        remove_db_files(&db);
    }

    #[test]
    fn zero_limit_authoritative_fraction_wins() {
        assert_eq!(
            honest_fraction(None, Some(0.0), Some(0.35)),
            Some(0.35)
        );
    }

    #[tokio::test]
    async fn unknown_keys_ignored() {
        let db = scoped_db("unknown-keys");
        let mut rows = signed_in_rows();
        rows.push(("someFutureKey", "whatever"));
        rows.push(("usage/billing", "not-real"));
        create_state_db(&db, &rows, false).await;
        let adapter = CursorAdapter::new().with_db_path(db.clone());
        let identity = adapter.get_identity().await.unwrap();
        assert_eq!(
            identity.account_key.as_deref(),
            Some("test-user@example.invalid")
        );
        remove_db_files(&db);
    }

    #[test]
    fn diagnosis_line_carries_no_identifiers() {
        let line = diagnosis_line(true, true, Some(42), ObservationStatus::Unsupported, 0);
        assert!(!line.contains('\n'));
        assert!(line.contains("signed_in=true"));
        assert!(!line.contains("example.invalid"));
        assert!(line.contains("windows=0"));
    }
}
