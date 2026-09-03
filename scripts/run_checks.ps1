#!/usr/bin/env pwsh
# Windows parity for scripts/run_checks.sh
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
python scripts/validate.py
node --check demo/app.js
node --check collectors/local.mjs
node --check collectors/store.mjs
node --check collectors/reconcile.mjs
node --check collectors/scheduler.mjs
node --check collectors/forecast.mjs
node --check collectors/alerts.mjs
node --check collectors/providers.mjs
node --check collectors/codex-app-server.mjs
node --check collectors/gemini-otlp.mjs
node --check collectors/daemon.mjs
node --check collectors/pollers.mjs
node --check scripts/live_smoke.mjs
node --check prototype/server.mjs
node --check connectors/claude-code/scripts/usage-halo-claude-bridge.mjs
python -m pytest -q
Write-Host 'UsageHalo checks: PASS'
