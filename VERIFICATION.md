# Verification report

This archive is intentionally explicit about verification status.

## Verified 2026-09-03 (Windows 11, Rust 1.98.1, Node 22, Python 3.11)

- `cargo fmt --check` — clean;
- `cargo clippy --workspace --all-targets -- -D warnings` — clean,
  including the Tauri shell crate;
- `cargo test --workspace` — 25 unit tests pass, 0 failures
  (core 2, reconcile 2, scheduler 4, secrets 3, forecast 4, storage 3,
  claude-code 2, codex 1, gemini-cli 2, anthropic 1, openrouter 1);
- `cargo check -p usage-halo-desktop` — Tauri shell compiles (required
  fixes, all verified by the compiler: shell added to workspace members,
  removed unknown `macOS.trashIgnores` key, trimmed capabilities to wired
  core permissions, generated `src-tauri/icons/` set via
  `scripts/generate_icons.py`);
- `npm run check` (svelte-check) — 0 errors, 0 warnings;
- `npm run build` (vite) — production bundle builds;
- `python -m pytest` — 29 tests pass (snapshot/registry/showcase,
  realistic-data, workflows, next-workflows, daemon);
- `python scripts/validate.py` — PASS;
- daemon `--once` sandboxed run writes health/daemon/alerts state and
  persists no secrets; pollers without keys return honest
  `{ live: false }`, never invented numbers;
- Windows `npm run tauri build` produces exe + MSI + NSIS setup (unsigned);
  Authenticode signing executes against a throwaway self-signed cert and the
  signature embeds (validation reports untrusted-root, exactly as expected
  for self-signed — release requires a public CA cert, wired in
  `.github/workflows/release.yml`);
- `cargo test -p usage-halo-secrets --features os-keychain` round-trips a
  real Credential Manager entry (set/get/delete, cleaned up);
- `scripts/privacy_audit.py` over the real data dir: clean;
- `tests/test_privacy.py` proves Claude ingest drops transcript/cwd at rest
  and the audit flags a seeded key;
- Codex stdio client verified against a fake app-server; OTLP fixture
  round-trip proves prompt attributes are stripped before storage.

## Verified while packaging (original scaffold)

- provider registry JSON parses successfully;
- demo JavaScript passes `node --check`;
- bridge scripts pass JavaScript syntax checking;
- fixtures parse successfully;
- SQLite migration applies successfully to an in-memory SQLite database;
- project tree and required documentation files are present;
- zero-dependency prototype server smoke test passes (`/api/health` + `/api/snapshot`);
- Claude status-line bridge privacy smoke test passes and drops transcript/workspace fields;
- ZIP integrity check passes.

## Not verified yet

- `npm run tauri build` packaging + signed/notarized artifacts on Windows,
  macOS and Linux (compilation is covered; bundling needs per-OS runners);
- live smoke tests against opt-in test accounts (OpenRouter/OpenAI/Cursor/
  Copilot/Mistral keys);
- signed/notarized build verification;
- secrets/keychain tests per platform (trait + aliases implemented,
  OS-keychain backend is next);
- privacy test proving prompts/responses are not persisted by default
  (bridge + OTLP stripping are fixture-tested; end-to-end store audit pending).

The original packaging runtime did not contain `cargo` / `rustc`; the gates
above were verified on 2026-09-03 instead. The Svelte production bundle now
builds (`npm run build` verified).

## Verified 2026-09-04 — realism hardening (webapp + desktop honest data)

Change `.planonce/work/realism-hardening-webapp-desktop` (shipped; plan digest
`sha256:a500d8d2…`, review `READY_WITH_BACKLOG`):

- Default `GET /api/snapshot` is honest-empty (`data_basis registry+live-overlay`,
  non-live `primaryPercent:null` + `provenance.sample:true`); deterministic sample
  kept behind `GET /api/snapshot?demo=1` (`sample_data:true`, `demo_mode:true`).
  Smoke: honest 1 live (real local Claude spool, 73%) vs demo 24 non-null.
- `/api/widget`, `/api/forecast`, `/api/alerts` are empty-safe (no hardcoded
  `58%`/`$12.47`/`62%`/burn arrays in live path; demo values only with `?demo=1`).
- Tauri `snapshot` projects 24 real registry rows (file-store + health + secret
  presence + live Claude spool) instead of `providers:[]`; `demo_provider_snapshot`
  is debug-only; `cargo check` + `clippy -D warnings` clean.
- Svelte + demo UIs render Unknown/Sample/empty states; hardcoded budgets, alerts,
  model rows, `200K` denominators, and hash heatmaps removed from live paths
  (Svelte heatmap shows empty-state unless live/sample; demo heatmap too).
- `python -m pytest -q` — 41 passed; `validate.py` PASS; `svelte-check` 0/0;
  `vite build` ok; `cargo test --workspace` 25 passed; `privacy_audit.py` clean;
  `daemon --once` all pollers honest `live:false` without keys.
- `.gitignore` fix: `lib/` → `/lib/` (was ignoring all of
  `apps/desktop-ui/src/lib/`); `src/lib/*.ts` now tracked.
- Tests touching the real spool (`test_showcase`, `test_realistic_data`
  legacy-import) back up and restore pre-existing files instead of deleting them.

## Required gates before a public release

1. `cargo fmt --check`
2. `cargo clippy --workspace --all-targets -- -D warnings`
3. `cargo test --workspace`
4. `npm ci`
5. `npm run check`
6. `npm run build`
7. `npm run tauri build` on each desktop OS
8. connector contract tests against recorded fixtures
9. live smoke tests against opt-in test accounts
10. signed/notarized build verification
11. secrets/keychain tests per platform
12. privacy test proving prompts/responses are not persisted by default
