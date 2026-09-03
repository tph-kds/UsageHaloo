# UI: Mock vs. Live Snapshots

**Rule:** Svelte UI must read reconciled projections via Tauri commands; it must not query SQLite directly. The current scaffold uses `apps/desktop-ui/src/lib/mock.ts` as the fixture layer; when swapped for live data, primary metric labels and freshness badges must remain distinct from reconciled/estimated values.

Why: Architectural boundary prevents the UI from absorbing SQLite schema or storage concerns; "0 usage" and "no current data" must be visually distinguishable, and reconciliation provenance must surface in the rail, popover, dashboard.

Where: `apps/desktop-ui/src/App.svelte:1` (consumes `mock.ts` today); `apps/desktop-ui/src-tauri/tauri.conf.json:1` (Tauri 2 config); `docs/03_ARCHITECTURE.md:92` (UI boundary).

Check: New UI component should accept provenance/source metadata and render a freshness badge; do not render forecast as observation; do not render estimated cost as provider cost.
