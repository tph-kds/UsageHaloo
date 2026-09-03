# Local collectors — honest, local-first provider detection

Zero-dependency Node module: `collectors/local.mjs`.

```bash
node collectors/local.mjs --json
```

## What it does

- **Detects** installed / configured providers without reading secrets:
  - Claude Code (`~/.claude.json`, spool `~/.usagehalo/inbox/claude-code.jsonl`)
  - Codex (`~/.codex/auth.json` presence only + official app-server for live rates)
  - Gemini CLI (`~/.gemini/settings.json`, OTel endpoint env)
  - OpenAI / Anthropic / OpenRouter / Z.ai / Perplexity / Mistral / xAI / DeepSeek / Groq / Together / Fireworks / Cerebras (env-key presence only)
  - Cursor / Copilot / Windsurf (config-dir / official APIs, never cookie scraping)
  - Ollama (`http://localhost:11434/api/ps`), LM Studio (`http://localhost:1234/v1/models`), LiteLLM, Bedrock, Azure, Vertex (presence only)
- **Reads live** only where safe: Claude spool, Ollama/LM Studio localhost, OpenRouter `/credits` when `OPENROUTER_API_KEY` is a management key.
- Every reading carries provenance `{ source, scope, freshness, observed_at, live }`.

## Wiring per provider (correct source per docs/02_PROVIDER_RESEARCH.md)

| Provider | Correct live source | Setup |
|---|---|---|
| Claude Code | statusLine JSON → bridge → spool | Add `node connectors/claude-code/scripts/usage-halo-claude-bridge.mjs` to your `statusLine` command chain (composing, not overwriting) |
| Codex | app-server `account/rateLimits/read` + `account/rateLimits/updated` | Sign in to Codex; the Rust sidecar speaks stdio JSON-RPC and subscribes |
| Gemini CLI | OTel `gemini_cli.token.usage` + GenAI semconv | Set `GEMINI_CLI_OTEL_EXPORT_ENDPOINT=http://127.0.0.1:4317` |
| OpenRouter | `GET /api/v1/credits` (management key) + response `usage.cost` | `OPENROUTER_API_KEY=<management key>` |
| OpenAI API | Org `usage/completions` + `costs` | `OPENAI_API_KEY=<admin key>` (org scope, separate from Codex subscription) |
| Ollama | `/api/ps` + per-response `prompt_eval_count`/`eval_count` | Run `ollama serve` — zero config |
| Generic OpenAI-compatible | response `usage` via opt-in gateway | `POST /api/ingest/event` with `{ provider, model, input_tokens, output_tokens }` only — prompts refused with 400 |

## Privacy rules enforced

- No secret values read or logged. No prompts/completions/messages. No browser-cookie scraping. No forced proxy. Secrets belong in OS keychain (desktop) / env (prototype).
- Raw observations immutable; UI reads reconciled projections; stale data shows `Sample` + provenance, never `0%`.
