# Implementation status

**Current phase:** Phase 5 — Local encrypted record engine<br>
**Status:** Phases 0, 1, 2, 3, and 4 delivered. Phase 2 protocol and crypto-core remain a prototype, **PENDING SECURITY REVIEW**. Phase 4 provides complete vault lifecycle management: independent zero-knowledge vault creation, client-side VEK generation, Argon2id p=4 password envelope derivation, HKDF recovery envelope derivation, in-memory volatile key unlocking, password rewrapping with fresh salt, vault deletion, and strict tenant isolation on the backend. All backend and frontend unit tests pass.

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

## Not implemented

Local IndexedDB encrypted record engine (Phase 5), CMS features (Phase 6), sync engine, streaming attachments, and production deployment are not implemented.

## Verification

- `npx turbo run build test` passed across all workspace packages and apps (9/9 tasks successful).
- `npx prettier --write .` and `npx eslint .` passed with 0 errors.
- Redocly lint passed with 0 errors.
- Go backend unit tests (`internal/auth` and `internal/router`) passed 100%.
- Client vault lifecycle vitest tests passed 100%.
- TypeScript packages and apps typecheck cleanly with 0 errors.

## Next phase

Phase 5 — Local encrypted record engine: Dexie/IndexedDB schema, client-side encryption of records and indexes using DEK wrapped by VEK, CRUD operations on records, and local change queuing.
