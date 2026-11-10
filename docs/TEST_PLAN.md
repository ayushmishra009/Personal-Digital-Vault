# Test plan

## Phase 0 verification targets

- Install the JavaScript workspace from its lockfile.
- Format, lint, type-check, and build each frontend and the Go API.
- Start PostgreSQL and RustFS through the PowerShell Compose helper; confirm PostgreSQL is healthy, RustFS responds at `/health`, and both published ports are loopback-bound.
- Start the API and verify `/health/live` returns success and `/health/ready` succeeds only when PostgreSQL is reachable.
- Confirm missing `DATABASE_URL` fails startup with a clear message.
- Confirm `.env` is ignored and generated credentials are not present in tracked files.
- Confirm CI runs formatting, lint, type checks, builds, and test commands.

## Phase 1 verification targets

- Generate the API client types from `contracts/openapi.yaml` and lint the OpenAPI 3.1 document.
- Type-check shared models, generated client types, and Zod schemas.
- Confirm strict request schemas reject unrecognized plaintext properties and require a password and recovery envelope for vault creation.
- Inspect the Go server domain package and SQL schema for plaintext vault content, titles, URLs, categories, or encryption keys.
- Apply the Goose migration, roll it back, then reapply it against a disposable PostgreSQL database.
- Verify account-scoped foreign keys reject cross-account vault/object relationships.
- Verify API handlers do not accept plaintext vault data after handlers are added in later phases.

These are planned checks. Phase 1's implementation pass did not add or run automated tests.

## Phase 2 cryptographic verification targets

- Verify RFC 5869 HKDF-SHA-256, RFC 3394 AES-KW, NIST AES-GCM, and RFC 9106 Argon2id known-answer vectors.
- Verify the proposed p=4 Argon2id vector and legacy p=1 vector in Rust/WASM, Node WASM, Chrome main-thread, and Chrome Worker. Primitive vectors cross-check with Go x/crypto v0.37.0. Keep the proposed production tuple PENDING SECURITY REVIEW.
- Verify envelope creation is p=4 only; unlock supports p=1 and p=4; wrong passwords and malformed/unsupported tuples fail closed; no implicit downgrade occurs.
- Verify password change and p=1-to-p=4 migration rewrap the same VEK, preserve existing encrypted payload bytes, and leave the independent recovery envelope usable and unchanged.
- Verify fixed password/recovery envelope regression fixtures across Node Web Crypto and Chrome Web Crypto, UTF-8 non-ASCII bytes, NFC/NFD distinction, and lone-surrogate rejection. Independent protocol review remains required.
- Verify the dedicated Worker success/error/cancellation lifecycle and main-thread responsiveness. Chrome p=4 was tested on one headless Windows host; process RSS, broader device coverage, and true memory-pressure/OOM handling remain outstanding.
- Run `node packages/crypto-core/test/run-chrome-provider.mjs` to exercise the actual TypeScript provider and Vite Worker URL transform in Chrome; verify p=1/p=4 outputs, cancellation, oversized-input rejection, and heartbeat responsiveness.
- Freeze and independently verify PDV context, password/recovery envelope, and object ciphertext golden vectors.
- Partial negative coverage implemented: wrong VEK; nonce, wrapped-DEK, ciphertext, and tag bit flips; vault/object/revision/payload-version/purpose substitution; invalid and noncanonical base64url, invalid nonce length, truncated ciphertext, and unsupported envelope/protocol identifiers. Remaining: resource caps and broader boundary coverage.
- Do not implement streaming attachment crypto until wire framing and truncation/final-tag rules are reviewed and have vectors.
- Implemented and run locally: context encoding candidate vector and invalid-field cases, plus the object-envelope negative cases listed above, in the crypto-core Node suite; expected context bytes were reconstructed separately with Node `Buffer` big-endian writes. This is not an independent security review, and GitHub Actions status has not been verified from this environment.
- Remaining vectors and checks are incomplete; see `docs/architecture/CRYPTO_TEST_VECTORS.md`.

## Phase 3 authentication and device verification targets

- Verify account registration creates initial active device and emits secure HttpOnly `pdv_session` cookie.
- Verify duplicate account registration fails with 409 Conflict.
- Verify invalid registration inputs fail with 422 Unprocessable Entity.
- Verify session endpoint returns account and device data for valid cookie, and 401 Unauthorized when missing or expired.
- Verify logout revokes session and clears cookie.
- Verify secondary device enrollment starts in `pending` state with challenge and 10-minute expiry.
- Verify `pending` device receives 403 Forbidden on active-device-required operational routes.
- Verify active device approves pending enrollment with cryptographic signature, activating the device.
- Verify expired or already-approved enrollment cannot be approved (409 Conflict).
- Verify device revocation invalidates all associated sessions immediately and blocks subsequent requests (401 Unauthorized).
- Verify cross-account tenant isolation (Account A cannot view, approve, or revoke Account B's enrollments or devices).

All Phase 3 verification targets pass in Go backend test suite (`apps/api/internal/router` and `apps/api/internal/auth`).

## Phase 4 vault lifecycle verification targets

- Verify `POST /api/v1/vaults` requires both `password` and `recovery` envelopes and enforces Argon2id p=4 parameters (p=4, m=65536 KiB, t=3).
- Verify duplicate envelopes in vault creation fail with 422 Unprocessable Entity.
- Verify `GET /api/v1/vaults` lists only vaults owned by the authenticated account.
- Verify cross-account tenant isolation: Account A cannot view, retrieve envelopes from, modify, or delete Account B's vaults (returns 404 Not Found).
- Verify `GET /api/v1/vaults/{vaultId}/envelopes/{envelopeType}` returns specific envelope and rejects invalid envelope types with 422.
- Verify `PUT /api/v1/vaults/{vaultId}/envelopes/password` updates the password envelope with new p=4 parameters and salt (204 No Content), without affecting the recovery envelope.
- Verify `DELETE /api/v1/vaults/{vaultId}` cascades deletion to key envelopes and subsequent lookups return 404 Not Found.
- Verify pending devices receive 403 Forbidden on all vault operational endpoints.
- Client verification in `apps/vault-web`:
  - Verify client generates 256-bit VEK and creates valid Argon2id p=4 and HKDF recovery envelopes.
  - Verify correct password unwraps VEK into `CryptoKey`.
  - Verify recovery secret unwraps VEK into `CryptoKey`.
  - Verify invalid password fails closed and throws error.
  - Verify password change re-wraps VEK with fresh salt and unlocks with new password while old password fails.

All Phase 4 verification targets pass in Go backend test suite (`apps/api/internal/router`) and frontend Vitest suite (`apps/vault-web/src/vault.test.ts`).

## Phase 5 local encrypted record engine verification targets

- Verify IndexedDB schema creates versioned stores (`encrypted_records`, `pending_operations`, `vault_metadata`, `sync_state`).
- Verify stored records contain only ciphertext object envelopes; plaintext titles, notes, passwords, and custom fields never appear in raw database storage.
- Verify saving password, secure note, identity, and payment records produces valid AES-256-GCM ciphertext with canonical context AAD and AES-256-KW wrapped DEKs.
- Verify valid VEK unwraps DEK and decrypts stored records without data loss.
- Verify wrong VEK fails closed and throws an error without returning plaintext.
- Verify record deletion removes ciphertext from `encrypted_records` and enqueues a tombstone `delete` operation with revision tracking into `pending_operations`.
- Verify client search filters in-memory decrypted records across title, tags, username, notes, URL, and custom fields.
- Verify password generator generates requested length, incorporates required charsets, excludes ambiguous characters when configured, and exhibits no modulo bias.
- Verify password strength estimator evaluates entropy and classifications.
- Verify inactivity tracker triggers callback after timeout and respects timer resets on user activity.

All Phase 5 verification targets pass in `apps/vault-web/src/storage/storage.test.ts`.

## Phase 6 CMS & admin foundation verification targets

- Verify `GET /api/v1/app/configuration` returns seeded default modules, navigation items, sections, and theme settings on first account access.
- Verify module listing and updates (`PUT /api/v1/admin/cms/modules/{moduleKey}`): validates display name, order, and enabled toggle.
- Verify section CRUD operations (`POST`, `PUT`, `DELETE` on `/api/v1/admin/cms/sections`):
  - Validates required fields (`screenKey`, `sectionType`, `title`).
  - Supports filtering by `screenKey`.
  - Supports ordering and toggling `isEnabled`.
  - Delete cascades and prevents subsequent retrieval.
- Verify theme retrieval and updates (`PUT /api/v1/admin/cms/theme`): validates presets, primary color, border radius, and density.
- Verify configuration revisions and audit logging:
  - Every administrative mutation generates an incremental revision snapshot in `cms_revisions` with a human-readable change summary.
  - `POST /api/v1/admin/cms/revisions/{revisionNumber}/restore` cleanly restores prior snapshots.
- Verify cross-account tenant isolation:
  - Account B cannot view Account A's custom sections, navigation items, or theme settings.
  - Account B cannot update or delete Account A's sections (returns 404 Not Found).
- Verify frontend declarative component registry (`CmsSectionRenderer`):
  - Renders whitelisted components (`welcome`, `summary`, `quick_actions`, `recent_items`, `vault_cards`, `custom_info`, `help_panel`).
  - Ignores disabled sections without rendering.
  - Safely ignores untrusted or unknown section types without throwing errors or executing scripts.
  - Escapes all text content; rejects raw HTML injection and XSS attempts in `custom_info` and title fields.

All Phase 6 verification targets pass in `apps/api/internal/router` (`TestCmsEndpointsAndSeeding`, `TestCmsTenantIsolation`) and `apps/vault-web/src/components/CmsSectionRenderer.test.tsx`.

## Later security and product coverage

Follow the master specification's crypto known-answer and negative tests, backend authorization/tenant isolation tests, offline/conflict tests, CMS schema/revision tests, attachment ciphertext checks, extension origin-boundary tests, and end-to-end flows. Round-trip crypto tests alone are insufficient. Do not use production data in tests.
