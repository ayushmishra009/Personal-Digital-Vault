# Security notes

## Current state

- This Phase 1 foundation is not suitable for real vault data.
- The API implements Phase 3 authentication and device enrollment with strict tenant enforcement and cryptographic session hashing.
- The API implements Phase 4 zero-knowledge vault lifecycle management with Argon2id p=4 parameter enforcement, envelope rewrapping, and tenant-scoped authorization.
- Phase 5 local record storage persists only AES-256-GCM / AES-256-KW ciphertext envelopes in IndexedDB. Plaintext passwords, notes, payment info, and identity data are never stored in browser storage.
- Decrypted record state and VEKs exist exclusively in transient volatile memory (`CryptoKey`) during unlock; an inactivity monitor automatically locks vaults and wipes memory after 15 minutes.
- The Admin frontend is an authenticated application (`apps/admin-web`) scoped strictly by account session authorization.
- Phase 6 CMS architecture enforces strict zero-knowledge boundaries: CMS tables (`cms_modules`, `cms_sections`, `cms_navigation_items`, `cms_theme_settings`, `cms_revisions`) store presentation and layout tokens only. No plaintext vault records, passwords, keys, or attachments are handled or persisted by the CMS.
- Cross-tenant CMS isolation: All CMS queries and mutations are partitioned by `account_id`. Attempts to access or modify another tenant's configuration return 404 Not Found without leaking existence or configuration data.
- Declarative component whitelist prevents XSS: Frontend rendering in `apps/vault-web` is mediated exclusively through `CmsSectionRenderer`. Only whitelisted section types (`welcome`, `summary`, `quick_actions`, `recent_items`, `vault_cards`, `custom_info`, `help_panel`) are executed. All content payloads are rendered as React text nodes; `dangerouslySetInnerHTML`, script injection, eval, and arbitrary HTML/CSS are strictly prohibited.
- Audit history: Every CMS configuration mutation creates an immutable snapshot in `cms_revisions` with actor device metadata and human-readable summaries, supporting one-click rollback.
- Phase 7 Main Web Application Client Security Hygiene:
  - Zero-knowledge boundaries maintained: Plaintext records (passwords, notes, identities, cards), unmasked numbers, VEKs, and DEKs reside exclusively in volatile React/DOM state during active unlock. Plaintext is never stored in `localStorage`, `sessionStorage`, IndexedDB, cookies, or logs.
  - Locking zeroization: Explicit user lock, vault switching, or inactivity timer expiration immediately destroys the in-memory `CryptoKey` VEK and wipes all decrypted record collections from React state.
  - Inactivity monitor: Auto-locks all active vaults after configurable periods of inactivity (default 15 minutes; configurable to 5m, 15m, 30m, 60m). User activity resets the timer.
  - Clipboard auto-clearing: Password and secret copying triggers an automatic clipboard wipe after 30 seconds.
  - Masked UI fields: Passwords, card numbers, CVVs, and government document numbers are masked by default with toggleable visibility to protect against shoulder surfing.
  - Safe Markdown & Content Rendering: Note preview renders markdown safely with strict HTML escaping, preventing XSS and script execution. External links are opened with `rel="noopener noreferrer"`.
  - Encrypted JSON Export: Backup archives are generated with AES-256-GCM authenticated encryption using keys derived from the user's vault key, ensuring backups are never exported in plaintext.
- Phase 2 crypto-core operations are a prototype, **PENDING SECURITY REVIEW**; stream encryption is not yet implemented.
- Decrypted Vault Encryption Keys (VEKs) reside strictly in volatile client memory (`CryptoKey`) during active unlock; locking clears in-memory keys immediately. Keys are never transmitted over the wire or stored in environment variables.
- The backend stores only opaque vault IDs, timestamps, and wrapped envelopes; it never receives plaintext labels, passwords, recovery secrets, or decrypted data.
- PostgreSQL and RustFS are development services. Compose binds their published ports to loopback and uses randomly generated local credentials in an ignored `.env`.
- The Go domain package contains server-safe metadata and ciphertext types. TypeScript decrypted record types are client-only and must never be serialized into API requests.
- Database tables contain no vault title, record title, URL, category, note, password, decrypted attachment, or key-material columns. Account IDs and composite foreign keys scope relational ownership; handlers must still enforce authorization and account filters when they are added.
- Phase 1 initially left algorithm and envelope values open. Phase 2 Zod/OpenAPI schemas now describe the proposed v1 format, but there are no API handlers; future handlers must enforce the same constraints and reject unsupported values.
- Phase 2 has a draft protocol, decision register, vector plan, and unreviewed crypto-core prototype under `docs/architecture/` and `packages/crypto-core/`. The RustCrypto 0.6.0 candidate and a dedicated Worker provider are implemented for validation, not connected to an application flow. Proposed new envelopes use p=4; p=1 remains unlock-only. Primitive vectors are cross-checked between RustCrypto and Go x/crypto and pass Node WASM and Chrome main-thread/Worker harnesses. The deterministic envelope fixture matches across Node and Chrome Web Crypto. Envelope, password-change, migration, recovery-independence, Unicode, and Worker lifecycle tests pass. Independent security review, reproducible-build verification, broader device/browser coverage, and real memory-pressure testing remain outstanding. Argon2id remains **PENDING SECURITY REVIEW**. Do not use this prototype with real data.

## Rules for upcoming work

- Plaintext vault data and encryption keys remain client-side. Never put keys in environment variables.
- Persist only ciphertext and minimum necessary metadata on server/storage services.
- Enforce ownership and authorization in backend handlers and database queries.
- Do not log plaintext, secrets, key material, or full encrypted payloads.
- Use synthetic data for development and test fixtures.
- Do not make zero-knowledge, secure, or production-ready claims without verified data-flow evidence and independent review.
- Treat proposed crypto details as review material. Argon2id still needs independent security and reproducible-build review, broader browser/hardware calibration, and independent envelope-vector verification; attachment stream framing is not implemented.

## Known limitations

Local credentials are convenience credentials, not a production secret-management design. The readiness endpoint checks PostgreSQL only; RustFS is not integrated with the API. RustFS is configured as a single-node development service. The schema does not yet enable row-level security; future handlers must scope every query by authenticated account and add isolation tests. Free-tier services may have usage limits, sleep behavior, policy changes, or no production SLA.

The Argon2 WASM C ABI bounds-checks pointer ranges against linear memory, validates fixed lengths, rejects overlap with the output range, and clears allocated buffers on free. It still relies on the trusted Worker calling `pdv_free` only with the exact live pointer/length pair returned by `pdv_alloc`; Rust cannot prove allocation provenance from a raw exported pointer. Native Rust test execution was blocked in this phase, and `cargo-audit` is not installed. Worker error and size-limit paths are tested, but real allocator exhaustion and Chrome process RSS are not.
