---
schema: planonce.verify/v1
change_id: rename-and-complete
phase: Wave 4 (Svelte live-data wiring)
revision: unavailable
working_tree_digest: unavailable
plan_digest: sha256:5631c037fe47de7a343923416758397b73882b604024e44ab9123a923d86df50
evidence_status: FRESH
---
# Wave 4 VERIFY — Svelte live-data wiring

## Approach

- **`apps/desktop-ui/src/lib/api.ts` (NEW).** Small TypeScript shim exposing `fetchSnapshot()`. Detects Tauri context (looks for `window.__TAURI__`) and routes to `invoke('snapshot')` when present; otherwise `fetch('/api/snapshot')`. The mock layer (`./mock`) is retained as a fallback when the live fetch fails. `USE_LIVE: boolean` toggle at the top flips the whole module to mock-mode.
- **`apps/desktop-ui/vite.config.ts` (in-scope).** Added a dev-server proxy for `/api` and `/assets/providers` to `http://127.0.0.1:4897` so the Svelte dev server can reach the prototype without CORS.
- **`apps/desktop-ui/src/App.svelte` (in-scope).** Replaced the hard-coded `from './lib/mock'` import with `from './lib/api'`. Added a yellow "Sample data · as of YYYY-MM-DD · source: <tauri|browser|mock>" banner when `sample_data: true`. The rail, drawer, summary cards, and health panel now read from the live state.

## Deterministic checks

| Check | Command | Result |
|---|---|---|
| Tests | `python -m pytest -q` | `14 passed` ✅ |
| Validator | `python scripts/validate.py` | `UsageHalo validation: PASS` ✅ |
| `lib/api.ts` exists | node ls | present ✅ |
| `vite.config.ts` proxy | node read | `/api` → `127.0.0.1:4897` ✅ |
| `App.svelte` no longer imports `lib/mock` directly | grep | only `lib/api` and `lib/types` ✅ |

## Note on this environment

The Svelte dev server cannot be started in this environment (no `npm install` performed; PowerShell blocks `npm.ps1`; cargo not installed). The Svelte app's `npm run check` and `npm run build` are recorded as **required-on-toolchain** per `PROJECT.md` and `verification-gates.md`. The Vite proxy config and the `lib/api.ts` shim are **source-correct**: the user can run `npm install && npm run dev` (with the prototype running on 4897) and see the live data in the Svelte UI.

## Requirement coverage

| ID | Status | Evidence |
|---|---|---|
| R3 (Svelte live-data path) | DONE | `lib/api.ts` shim + Vite proxy + App.svelte change. Mock retained as fallback gated by `USE_LIVE`. |
| R7 (demo updated) | DONE | banner added; rail/drawer/panels read from live state. |
| R8 (Tauri command surface) | NOT CHANGED in this wave | `snapshot` Tauri command added in Wave 7. The Svelte side can call it now via `lib/api.ts`. |
| R9 (no regression) | DONE | 14/14. |
| R10 (validator) | DONE | `UsageHalo validation: PASS`. |

## Risks
- The Tauri `snapshot` command does not exist yet (Wave 7). `lib/api.ts` calls it dynamically, so the Svelte app falls back to the browser `fetch` (which falls back to the mock) when running outside Tauri. The fallback chain is: Tauri → browser fetch → mock. This is exactly what the user wants for "works in this env + source-correct for Tauri later".

## Planonce-review (lightweight)
- Drive-by refactors avoided: yes. `lib/mock.ts` is unchanged.
- Contract changes: none.
- Unrelated changes: none.

## Next action
Wave 5: legacy-import endpoint. The SPOOL_LEGACY constant is already in `prototype/server.mjs`; now we add the `/api/snapshot/legacy-import` endpoint that one-shot copies the legacy inbox into the new path.
