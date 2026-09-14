# Phase D matrix — secondary providers (2026-09-14, this machine, Windows)

Rule applied: no adapter is built that cannot be proven against real state.
An honest unconfigured state ships instead of an unverified integration
(brief sections 6, 31 and the Perplexity precedent).

## Detection evidence (commands run, presence only, no secret values read)

- GitHub Copilot: no gh CLI; no copilot entries under ~/.vscode/extensions;
  no GITHUB_TOKEN. No login session to reuse.
- OpenCode: shim on PATH (npm) but ~/.config/opencode holds an unrelated node
  project (node_modules, package.json) and NO auth.json. No account state.
- Kimi, Grok, ZCode/GLM: no ~/.kimi, ~/.xai, ~/.zai state dirs. No CLIs found.
- DeepSeek: no DEEPSEEK_API_KEY in env. Only signal is 15 stale instrumented
  tokens from 2026-09-03 (now correctly stale, D unit 0).
- Perplexity: no configured account or API state found. No documented local
  source exists for the product on this machine.
- Ollama: 127.0.0.1:11434 refuses connections. LM Studio: 127.0.0.1:1234
  refuses connections. Both report unavailable with null numerics (verified).
- OpenRouter/OpenAI: no management/admin keys in env or keychain-backed
  aliases; collectors skip honestly with no_key (proven by
  missing_keys_skip_honestly_without_health_rows, no health rows written).

## Status per provider

| Provider | Detection | Account | Source | Status |
|---|---|---|---|---|
| GitHub Copilot | absent | none | none verified | UNCONFIGURED (no session to reuse) |
| OpenCode | shim only | none | none verified | UNCONFIGURED (no account state) |
| Kimi | absent | none | none verified | UNCONFIGURED |
| Grok | absent | none | none verified | UNCONFIGURED |
| ZCode/GLM | absent | none | none verified | UNCONFIGURED |
| DeepSeek | key absent | none | stale instrumented tokens only | STALE telemetry, billing UNSUPPORTED |
| Perplexity | absent | none | none verified | UNSUPPORTED (honest, per brief) |
| Ollama | endpoint down | n/a | runtime API unreachable | UNAVAILABLE (no fake quota) |
| LM Studio | endpoint down | n/a | runtime API unreachable | UNAVAILABLE (no fake quota) |

## What was NOT built, and why

No Rust adapters, parsers, or fixtures for the above beyond the Ollama shape
contracts (fixtures/ollama, parser-only). An adapter without a real source to
prove it against would be decoration, which the brief explicitly rejects. Each
becomes a scoped lane the moment installable state or credentials exist on a
verification machine.

## Zero-fabrication audit (2026-09-14, /api/snapshot, 24 providers)

22 null percent pairs. Non-null only: claude-code (stale) and codex
(stale last-known-good), both with observed_at, age_seconds, sample:false.
No other provider renders a number it cannot source.
