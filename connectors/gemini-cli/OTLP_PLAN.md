# Gemini CLI OTLP receiver implementation note

Production implementation should add `opentelemetry-proto`/`tonic` or an OTLP HTTP protobuf receiver and retain only approved metrics.

Required metric for v1:

- `gemini_cli.token.usage`
  - attribute `model`
  - attribute `type`: input/output/thought/cache/tool

Do not persist prompt/message attributes from generative-AI spans. The receiver should discard them before converting into the canonical `UsageEvent`.
