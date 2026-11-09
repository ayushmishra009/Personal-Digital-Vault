# Implementation status

**Current phase:** Phase 2 — Cryptographic protocol specification and prototype<br>
**Status:** Phase 1 complete. Phase 2 protocol and crypto-core remain a prototype, **PENDING SECURITY REVIEW**. RustCrypto Argon2 0.6.0 WASM is connected to a dedicated Worker provider for validation; it is not connected to an application flow. New envelope creation is p=4 only and strict unlock supports legacy p=1 plus proposed p=4. Primitive vectors are cross-checked against Go x/crypto v0.37.0 and pass in Node WASM, Chrome main-thread, and Chrome Worker. Chrome 156.0.8078.81 p=4 six-run medians were 268.8 ms main-thread and 289.2 ms Worker; WASM linear memory measured 68,681,728 bytes page and 68,354,048 bytes Worker. A Vite-served Chrome integration test exercises the actual TypeScript Worker provider, confirming p=1/p=4 vectors, the deterministic password/recovery envelope fixture across Node and Chrome Web Crypto, cancellation, oversized-input rejection, and 143 heartbeat ticks. The separate Worker benchmark harness confirmed responsiveness and termination cancellation. This is one headless Windows host; process RSS, representative-device coverage, and actual memory-pressure behavior were not measured. Native Rust tests and clean-build reproducibility checks were blocked by Windows Application Control. Independent security review, reproducible-build verification, and wider compatibility review remain required. No security approval is claimed.

## Repository state at start

The repository contained only the master build specification and Git metadata. No application source, environment files, dependencies, database schema, or migrations were present.

## Phase 0 scope delivered

- pnpm workspace and Turborepo configuration.
- Separate React/Vite shells for the Vault and Admin/CMS applications.
- WXT Chrome extension shell with no requested permissions.
- Go API shell with liveness and PostgreSQL readiness endpoints.
- Docker Compose services for loopback-bound PostgreSQL and RustFS (MinIO image pull was unavailable).
- PowerShell helper to generate ignored local credentials and manage Compose.
- Environment example, ignore rules, CI workflow, README, and repository instructions.
- Architecture, security, decision, and test-plan records.

## Phase 1 scope delivered

- Go server domain types for account/device metadata, opaque vault metadata, envelopes, ciphertext revisions, sync events, attachments, and audit events.
- TypeScript shared models with decrypted record types explicitly marked client-only.
- Strict Zod schemas for account/device metadata, vault metadata and envelopes, ciphertext object envelopes, sync operations, and client-decrypted records.
- OpenAPI 3.1 contract and generated TypeScript API types, with Redocly validation.
- Initial Goose migration for account, authentication credential metadata, devices/enrollments, vaults/key envelopes, encrypted object revisions, sync events, attachments, idempotency, and audit metadata.
- Account-scoped foreign keys and indexes; no plaintext vault labels or record fields in server models or tables.

## Not implemented

Authentication, authorization, API handlers beyond health, CMS features, vault lifecycle integration, a concrete Argon2id provider, streaming attachments, sync processing, object-storage API integration, and production deployment are not implemented. The Admin app is only a shell and is not yet protected by authentication. Database ownership constraints do not substitute for account-scoped authorization in handlers. Crypto-core is a prototype; do not use this scaffold with real vault data.

## Verification

- `pnpm install --frozen-lockfile` completed. The workspace allows the `esbuild` build script and explicitly blocks `spawn-sync`.
- `pnpm api:generate` and `pnpm contract:lint` passed.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` passed.
- Goose migration up, down, and up again all succeeded against local PostgreSQL; the final schema is applied.
- Automated tests were not run in this pass.
- For the Phase 2 prototype, direct TypeScript checks passed for crypto-core, validation, and generated API client; ESLint passed for crypto-core/validation; OpenAPI type generation and Redocly lint passed; `git diff --check` passed.
- Earlier Phase 2 checks listed above predate the KDF validation stage and do not supersede the current results below.
- Current KDF validation: seven Node envelope/provider tests passed, including p=4 creation, p=1 compatibility/migration, recovery independence, unchanged payloads, Unicode edge cases, strict tuple validation, and Worker lifecycle.
- Current KDF validation also passed TypeScript crypto-core/validation typechecks, Rust formatting, release WASM build, Node WASM p=1/p=4 vectors, and Chrome p=1/p=4 vectors. Native cargo tests and two-clean-build reproducibility checks were blocked by Windows Application Control (OS error 4551). Chrome p=4 medians: 268.8 ms main thread and 289.2 ms Worker; WASM linear memory: 68,681,728 bytes page and 68,354,048 bytes Worker. The Worker benchmark harness recorded 425 main-thread heartbeat ticks; the actual provider integration harness reported 104. Independent security review, broader devices, process RSS, and actual OOM behavior remain outstanding.
- Actual TypeScript Worker provider integration in Chrome passed through Vite: p=1/p=4 outputs matched, envelope fixtures matched across Node and Chrome Web Crypto, cancellation terminated the worker, oversized input rejected, and 143 main-thread heartbeat ticks were observed.
- The initial MinIO image pull failed because Quay returned `401 UNAUTHORIZED`; local object storage was changed to RustFS and recorded in ADR-0002.

## Next phase

Complete independent security and reproducible-build review, independently cross-check envelope fixtures, and gather broader browser/device and memory-pressure evidence. Keep the proposed p=4 protocol PENDING SECURITY REVIEW. Separately pin/review the `libsodium-wrappers` secretstream candidate, review its proposed framing, and complete remaining protocol vectors/negative tests before closing Phase 2. Do not proceed to Phase 3 until Phase 2 acceptance criteria are met.
