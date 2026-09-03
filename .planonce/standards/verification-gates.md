# Verification Gates

**Rule:** Treat the following as the canonical PlanOnce verification gates. Always run the Python gates; run the Rust and Svelte gates when the matching toolchain is available. Record evidence (test output, fixture parse, demo/bridge syntax check) with the change.

Always-on (no Rust/Node toolchain beyond Python required):
- `python scripts/validate.py` — required files, provider registry, fixtures, migration, Claude privacy guardrail
- `python -m pytest -q` — runs `tests/test_migration.py` and `tests/test_registry.py`
- `node --check demo/app.js` and `node --check connectors/claude-code/scripts/viusage-claude-bridge.mjs` and `node --check prototype/server.mjs`

Toolchain-dependent (record as "not executed in this environment" if unavailable):
- Rust: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`
- Svelte/Tauri: `npm run check`, `npm run build`, `npm run tauri build` (per OS)

Why: `scripts/run_checks.sh` already composes this exact set; honoring it prevents silent breakage of registry, fixtures, or the privacy guardrail.

Where: `scripts/run_checks.sh:1`; `VERIFICATION.md:23` (release gate list); `apps/desktop-ui/package.json:7` (npm scripts); `Cargo.toml:1` (workspace).

Check: When the env lacks `cargo` or npm policy blocks `npx.ps1`, do not silently skip — record that fact in STATE/plan and continue with the always-on gates.

## Provider asset contract (for completeness)

`scripts/validate.py` enforces the canonical provider-asset layout:

- `assets/providers/<dir>/<base_stem>.svg` (default)
- `assets/providers/<dir>/<base_stem>-light.svg`
- `assets/providers/<dir>/<base_stem>-dark.svg`

The id→(dir, base_stem) mapping comes from `assets/providers/icon-manifest.json` (keyed by directory name, with `base_stem` matching the registry id in `packages/brand-registry/providers.json`). Mismatches such as registry `aws-bedrock` → dir `aws` / stem `aws-bedrock`, or registry `openai-api` → dir `openai` / stem `openai-api`, are intentional and resolved through the manifest. New providers must add both a registry entry and a manifest entry with matching base_stem.
