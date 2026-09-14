# Gemini CLI / Antigravity local state (observed 2026-09-14)

Observed layout on this machine:

- No `gemini` CLI on PATH.
- `~/.gemini/` exists with:
  - `google_accounts.json` (keys: `active`, `old` — account identifier source;
    only the `active` value is ever read, never any token file)
  - `tmp/` project-hash directories
  - `antigravity/` brain directories
  - `antigravity-browser-profile/`
- `~/.antigravity/` exists (extensions only).
- No local quota/limit files found anywhere (searched).

Product owner of quota semantics here: Antigravity. No verified quota
source exists for this product.

Capability statement: the only verified data class is request-count
telemetry via OTLP (`gemini_cli.token.usage` through the prototype
`/v1/metrics` ingest). It is DERIVED-only and never quota: request
counts carry no denominator, so no quota window can be constructed
from them. See `fixtures/gemini-otlp-metrics.json` for the observed
OTLP shape.
