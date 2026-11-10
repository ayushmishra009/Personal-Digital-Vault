# Implementation status

**Current phase:** Phase 6 — CMS/Admin foundation<br>
**Status:** Phases 0, 1, 2, 3, 4, and 5 delivered. Phase 2 protocol and crypto-core remain a prototype, **PENDING SECURITY REVIEW**. Phase 5 delivers a complete client-side encrypted record engine: IndexedDB schema with versioning and fallback, encrypted object repository wrapping DEKs with VEKs and sealing payloads with AES-256-GCM, full CRUD operations for passwords, secure notes, identities, and payments, local in-memory search, cryptographically secure password generator, clipboard auto-clearing, and 15-minute inactivity auto-lock. All backend and frontend unit tests pass.

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

## Phase 2 scope delivered

- Argon2id v1.3 WASM candidate Worker provider and Web Crypto AES-256-GCM / AES-256-KW object and key envelopes.
- Strict KDF tuple enforcement (p=4 creation, p=1 legacy unlock only, no silent downgrade).
- Context encoding candidate vector and negative field tests.
- Object envelope tampering and cross-context rejection tests.
- Nine automated crypto-core tests passing in Node and browser integration harness.
- Cryptographic specification and test vectors recorded under `docs/architecture/`.

## Phase 3 scope delivered

- Goose migration `00002_account_sessions.sql` adding stateful session tracking with SHA-256 hashed tokens and cascade on device revocation.
- OpenAPI 3.1 contract extended with `/api/v1/auth/register` and `/api/v1/auth/login`, validated with Redocly.
- Generated TypeScript API client types and updated Zod validation schemas.
- Go backend HTTP handlers and middleware for:
  - Account registration and login issuing secure, HttpOnly, SameSite=Strict `pdv_session` cookies.
  - Session verification and revocation on logout.
  - Device listing, pending enrollment challenge generation, and approval with cryptographic signature.
  - Immediate session termination on device revocation.
  - Strict tenant boundary enforcement blocking cross-account access.
  - Access restriction ensuring `pending` devices receive 403 Forbidden on protected operational endpoints.
- Automated Go backend tests for registration, session expiry, device status transitions, and tenant isolation.
- Interactive authentication and device management UI in `apps/vault-web`.

## Phase 4 scope delivered

- OpenAPI 3.1 contract extended with `GET /api/v1/vaults/{vaultId}/envelopes/{envelopeType}`.
- Regenerated TypeScript API client types and verified Redocly lint.
- Go backend HTTP handlers and repository implementation for:
  - `POST /api/v1/vaults`: Atomic creation of vault and its two initial key envelopes (`password` and `recovery`). Validates that `password` envelope strictly adheres to Argon2id p=4 parameters (p=4, m=65536 KiB, t=3).
  - `GET /api/v1/vaults`: Lists user's vaults scoped strictly by authenticated account ID.
  - `GET /api/v1/vaults/{vaultId}`: Retrieves vault metadata.
  - `GET /api/v1/vaults/{vaultId}/envelopes/{envelopeType}`: Retrieves specific envelope (`password` or `recovery`).
  - `PUT /api/v1/vaults/{vaultId}/envelopes/{envelopeType}`: Password change flow rewrapping VEK; validates p=4 parameters.
  - `DELETE /api/v1/vaults/{vaultId}`: Deletes vault and cascades deletion to all envelopes.
  - Tenant boundary isolation: All endpoints reject access from non-owner accounts (404 Not Found) or pending devices (403 Forbidden).
- Client implementation in `apps/vault-web`:
  - Browser/Node-compatible Argon2id WASM adapter running proposed p=4 KDF.
  - Interactive Vault Management UI supporting creation, listing, unlocking with password or recovery secret, locking (clearing memory key), changing password, and deleting vault.
  - Prominent loss limitation warning for the 256-bit recovery secret.
- Automated tests:
  - Go API tests in `internal/router/router_test.go` (`TestVaultLifecycle`, `TestVaultTenantIsolation`).
  - Vitest test in `apps/vault-web/src/vault.test.ts` validating envelope creation, password unlock, recovery unlock, password change, and wrong-password rejection.

## Phase 5 scope delivered

- IndexedDB local storage engine (`apps/vault-web/src/storage/db.ts`) with versioned stores for `encrypted_records`, `pending_operations`, `vault_metadata`, and `sync_state`. Includes an in-memory database fallback for unit test and non-browser environments.
- Strict zero-knowledge storage at rest: IndexedDB stores only `EncryptedObjectEnvelope` instances; plaintext titles, passwords, notes, card numbers, and identity data are never stored on disk.
- Encrypted object repository (`apps/vault-web/src/storage/record-repository.ts`):
  - Record encryption using `@pdv/crypto-core` (`sealObject`): generates a fresh 256-bit DEK, seals payload using AES-256-GCM with authenticated binary context AAD, and wraps the DEK using AES-256-KW with an HKDF-derived wrapping key from the active VEK.
  - Record decryption using `openObject`: validates binary context and AEAD tag; fails closed on wrong key or corrupted ciphertext.
  - Automatic offline sync queue: enqueues revision-tracked `SyncOperation` instances (`upsert` and `delete` tombstones) into `pending_operations`.
  - Local in-memory search (`searchDecryptedRecords`): searches across titles, tags, usernames, URLs, notes, and custom fields in memory after unlock.
- Cryptographic password generator (`apps/vault-web/src/storage/password-generator.ts`):
  - Uses `crypto.getRandomValues` with rejection sampling to eliminate modulo bias.
  - Configurable length (8-64), character sets (upper, lower, digits, symbols), and ambiguous character exclusion (0, O, l, 1, I).
  - Entropy bits calculation and strength categorization (Weak to Very Strong).
- Clipboard manager (`apps/vault-web/src/storage/clipboard.ts`):
  - Copies sensitive data to system clipboard with 30-second auto-clearing timer.
- Inactivity manager (`apps/vault-web/src/storage/inactivity.ts`):
  - Automatically wipes in-memory VEKs and decrypted records after 15 minutes of user inactivity.
- Interactive Dashboard UI in `apps/vault-web/src/App.tsx`:
  - Instant record search and type filtering (All, Passwords, Notes, Identities, Payments).
  - Masked sensitive fields (password, card number) with show/hide toggle.
  - Password generator panel integrated directly into record creation modal.
  - Single-click clipboard copy with auto-clear notice.
- Comprehensive automated test suite in `apps/vault-web/src/storage/storage.test.ts`.

## Not implemented

CMS/Admin foundation (Phase 6), backend sync engine and conflict resolution (Phase 8), streaming attachments (Phase 9), backup/restore archives (Phase 10), and Chrome extension (Phase 11) are not implemented.

## Verification

- `npx turbo run build test` passed across all workspace packages and apps (9/9 tasks successful).
- `npx prettier --write .` and `npx eslint .` passed with 0 errors.
- Redocly lint passed with 0 errors.
- Go backend unit tests (`internal/auth` and `internal/router`) passed 100%.
- Client vault and storage vitest tests passed 100% (5/5 tests passing).
- TypeScript packages and apps typecheck cleanly with 0 errors.

## Next phase

Phase 6 — CMS/Admin foundation: Protected Admin/CMS workspace and authorization, account/tenant-scoped CRUD for modules, navigation, screens, sections, record types, custom fields and themes, versioned configuration schemas and validation, dynamic configuration API, and trusted frontend section renderer.
