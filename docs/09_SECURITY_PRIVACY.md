# Security and privacy

## Threat model

UsageHalo may have access to high-value API credentials and local coding-agent telemetry. A compromise could expose billable accounts or sensitive developer activity.

Security must therefore be a product feature, not an afterthought.

## Secret handling

Rule:

> Usage data may go to SQLite; credentials do not.

Use platform secure storage:

- Windows Credential Manager / DPAPI-backed credential APIs;
- macOS Keychain;
- Linux Secret Service/libsecret where available;
- iOS Keychain;
- Android Keystore plus encrypted storage.

Persist only a `secret_alias` in application configuration.

## Data minimization

Default retention must exclude:

- prompts;
- responses;
- source code;
- transcript bodies;
- tool arguments/results;
- browser cookies;
- unneeded filesystem paths;
- repository names unless the user explicitly enables project attribution.

### Claude example

Status-line JSON contains fields that UsageHalo does not need. Sanitization should happen before persistence.

## Connector permission view

Each connector page should expose:

```text
Reads
✓ quota percentages
✓ reset timestamps
✓ token counters
✓ model identifier

Does not read/store by default
✕ prompts
✕ responses
✕ source files
✕ transcript content
✕ tool arguments
```

## Network policy

Each connector declares allowed domains. Optional future plugin sandbox enforces that list.

No hidden telemetry from UsageHalo itself. Product analytics, if ever introduced, must be opt-in and independent from AI usage data.

## Request instrumentation

The optional local gateway must:

- bind to localhost by default;
- never install a root CA;
- never perform TLS MITM;
- accept explicitly configured clients only;
- persist usage metadata rather than payloads;
- provide per-client disable controls.

## Local database

Recommended:

- application-private permissions;
- WAL mode;
- optional whole-database encryption for users needing stronger at-rest protection;
- retention policy and wipe control;
- export that excludes credentials.

## Cross-device sync

If introduced:

- end-to-end encrypted payloads;
- server cannot read telemetry content;
- per-device keys;
- device revocation;
- independent opt-in;
- local-only mode remains fully supported.

## Supply chain

- lock dependencies;
- signed releases;
- macOS notarization;
- Windows code signing;
- SBOM;
- dependency vulnerability scanning;
- reproducible connector fixtures;
- no runtime download/execution of unaudited connector code.

## Logging

Production logs must redact:

- Authorization headers;
- API keys;
- cookies;
- raw provider payloads unless debug mode explicitly enables a sanitized dump;
- user paths.

Debug bundles should be previewable before export.
