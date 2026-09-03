# Supply Chain and Runtime Safety

**Rule:** Lock dependencies, sign releases, notarize macOS, sign Windows, ship SBOM. Do not load unaudited connector JavaScript with unrestricted filesystem/keychain access. Production logs must redact Authorization headers, API keys, cookies, raw provider payloads, and user paths.

Why: High-value credentials + provider API surface; a compromised dependency or a permissive third-party connector would expose the same blast radius as a key leak. Documented in `docs/09_SECURITY_PRIVACY.md:99` (supply chain) and `docs/09_SECURITY_PRIVACY.md:110` (logging).

Where: `docs/09_SECURITY_PRIVACY.md:99`; `docs/03_ARCHITECTURE.md:154` (extension architecture: WASI sandbox with declared network domains, file permissions, secret aliases, polling interval, emitted metric types).

Future-state invariants (not yet enforced by code):
- Plugin sandbox must be a constrained WASI component or subprocess protocol, never unrestricted fs/keychain.
- Debug bundles previewable before export; raw payload dumps require explicit debug-mode opt-in.

Check: Any new release script or CI workflow must include lock, signing, SBOM, and dependency vulnerability scanning steps before allowing a public release per `VERIFICATION.md:23`.
