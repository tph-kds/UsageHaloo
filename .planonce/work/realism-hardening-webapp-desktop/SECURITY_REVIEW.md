# Security Review

- **Revision / baseline:** baseline `c4b6a83e15ef62c27eaf38b07671b4c75c210c9c` → current worktree (uncommitted; 10 files, +529/−118)
- **Scope:** Diff review of `realism-hardening-webapp-desktop` (prototype honest snapshot, Tauri real rows, Svelte/demo un-hardcode, test updates, `.gitignore` amendment)
- **Trust model:** local-first desktop app; localhost sidecar `:4897`; Tauri IPC; env/keychain secrets; no new network listeners or credential flows
- **Tools actually run:** `privacy_audit.py` (clean, 5 files/84 rows), `test_privacy.py` (in pytest 41 pass), `cargo clippy -D warnings` (clean), secret-pattern grep over diff (no hits), manual trust-boundary diff inspection
- **Checks NOT_RUN / BLOCKED:** no external scanner installed (Semgrep/Trivy/Gitleaks — NOT_RUN, repo-native preferred per skill); no network/live-account smoke (NOT_RUN by policy NG4); OS-keychain round-trip not re-run here (prior VERIFICATION.md covers Windows)

## Threat model summary

Assets: `~/.usagehalo/store/*.jsonl`, spool inbox, env API keys, SQLite (untouched). Actors: local user, local processes on loopback, malicious webpage (XSS context for demo HTML). Entry points: `POST /api/ingest/*`, `POST /v1/metrics`, Tauri `invoke('snapshot')`, static asset routes, widget fetch. Boundaries unchanged by this diff — no new listeners, no new auth, no transcript ingestion. Invariants preserved: telemetry-only ingest (prompt refusal), alias-only secrets, `isInside` static guard, CSP/tauri capabilities untouched.

## Findings

### Finding ID: SEC-01
- **Severity:** Low
- **Confidence:** Medium
- **Origin:** PRE-EXISTING (pattern retained, not introduced)
- **Evidence:** `demo/widget.html:38-39` `w-rows` innerHTML interpolates `p.displayName` unescaped; `demo/app.js` tray/provider-card paths use `esc()` but widget row does not
- **Attack path / preconditions:** requires attacker-controlled `displayName` in registry JSON or snapshot payload rendered by the local widget page; registry is a local repo file, snapshot is localhost — needs local file compromise first
- **Impact:** self-XSS in the local demo page only; no credential access beyond what file access already grants
- **Recommended fix:** wrap with existing `esc()`-equivalent in widget script (deferred to follow-up; demo page, not Tauri surface)
- **Verification needed:** follow-up `planonce-security-fix` or inline escape + `node --check`

### Finding ID: SEC-02
- **Severity:** Low
- **Confidence:** Low
- **Origin:** PRE-EXISTING
- **Evidence:** `apps/desktop-ui/src-tauri/tauri.conf.json:63-70` updater endpoint `https://example.invalid/...` + dummy pubkey (untouched by this diff)
- **Attack path / preconditions:** none while placeholder — `check_for_updates` always errors honestly; risk only if shipped to users expecting updates
- **Impact:** updates non-functional until real feed configured; no auto-install path (`check_for_updates` never installs)
- **Recommended fix:** configure real feed + pubkey before public release (already a release gate in VERIFICATION.md)
- **Verification needed:** release-gate check, out of scope for this change

## No-finding evidence

- Secret exposure: diff adds no keys/tokens/credentials; OpenRouter key stays env-only (`server.mjs:415`); Tauri uses `secrets.has(alias)` presence booleans only (`lib.rs:291,449`); no secret values in snapshot responses.
- Ingest hardening intact: `telemetry_fields_only` refusal (`server.mjs` ingest/event), OTLP prompt-attr stripping, 32K/256K body caps — all untouched; `test_privacy.py` passes.
- Path traversal: `serveAssetsStatic` + `isInside` unchanged; traversal test passes.
- Deserialization: new Rust spool parsing is `serde_json::from_str` into typed structs, last-line only, no exec; `rfind` line selection is panic-free (`Option` chain).
- `.gitignore` amendment (`lib/` → `/lib/`): un-ignores `src/lib/*.ts` for tracking; does not expose secrets (no key material in those files; `.env*` rules untouched).
- `demo_provider_snapshot` debug-gating reduces release attack surface (one fewer IPC command in release builds).
- `setup()` `create_dir_all` on `~/.usagehalo/store` — no symlink/permission escalation (user-owned homedir, no mode change).

## Residual risk

- No SAST/dependency scan run (no new deps added — `include_str!` registry only — so supply-chain delta is nil, but scanner coverage is absent).
- Widget self-XSS (SEC-01) accepted as backlog; demo is localhost-only.
- Updater feed placeholder (SEC-02) must block public release, not this merge.
- Untracked `src/lib/` files need `git add` review before commit (verify no secrets — confirmed none).

## Human decision

Risk disposition requested: accept SEC-02 as backlog (pre-existing, Low) and proceed to `planonce-review` + ship gate.
Update 2026-09-04: SEC-01 fixed in `demo/widget.html` (displayName escaped in `w-rows` render); `node --check demo/app.js` clean. Only SEC-02 remains as backlog.
