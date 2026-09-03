# Runnable zero-dependency prototype

The production plan is Rust/Tauri, but this tiny Node runtime makes the ZIP immediately testable without installing dependencies.

```bash
node prototype/server.mjs
```

Then open:

- `http://127.0.0.1:4897`
- `http://127.0.0.1:4897/api/snapshot`

The prototype reads the last sanitized Claude Code status-line spool entry from:

`~/.usagehalo/inbox/claude-code.jsonl`

If none exists it uses the safe fixture bundled in this repository.

You can also test ingest:

```bash
curl -X POST http://127.0.0.1:4897/api/ingest/claude \
  -H 'content-type: application/json' \
  --data-binary @fixtures/claude-statusline.json
```

This prototype intentionally keeps only an approved telemetry subset.
