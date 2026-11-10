# Implementation status

**Current phase:** Phase 4 — Vault lifecycle<br>
**Status:** Phases 0, 1, 2, and 3 delivered. Phase 2 protocol and crypto-core remain a prototype, **PENDING SECURITY REVIEW**. Phase 3 provides full account registration, login, session cookies with SHA-256 token hashing, device lifecycle (active, pending, revoked), cryptographic pairing enrollment and approval, and strict tenant isolation at the API boundary. All backend and frontend unit tests pass.

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

## Not implemented

Vault key generation (VEK/DEK lifecycle in application flow), local IndexedDB encrypted record engine, CMS features, streaming attachments, sync processing, and production deployment are not implemented.

## Verification

- `npx turbo run build test` passed across all workspace packages and apps.
- `npx prettier --check .` and `npx eslint .` passed.
- Redocly lint passed with 0 errors.
- Go backend unit tests (`internal/auth` and `internal/router`) passed 100%.
- TypeScript packages and apps typecheck cleanly with 0 errors.

## Next phase

Phase 4 — Vault lifecycle: Independent vault creation, VEK generation, password envelope, recovery envelope, lock/unlock mechanics, password change by rewrapping VEK, and local encrypted vault metadata.
