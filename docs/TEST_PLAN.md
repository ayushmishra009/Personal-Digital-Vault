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

## Phase 7 main web application verification targets

- Verify application navbar (`AppNavbar`) renders active vault selector, locked/unlocked state badges, search bar, generator button, and auto-lock countdown timer.
- Verify sidebar navigation (`AppSidebar`) reflects record counts for passwords, notes, identities, payments, and documents.
- Verify `DashboardView` renders dynamic CMS sections via `CmsSectionRenderer`, security parameter badges, summary metrics, and recent record cards.
- Verify `PasswordsView`:
  - Renders password records with username, domain, and tag badges.
  - Masks password values by default with an interactive reveal toggle.
  - Displays empty state prompt when no password records exist.
- Verify `NotesView`:
  - Renders master-detail split layout with preview list and reading pane.
  - Safely renders markdown-formatted content without script execution.
  - Displays character and word count statistics.
- Verify `IdentitiesView`:
  - Renders structured cards for passports, driver's licenses, national IDs, and SSNs.
  - Masks sensitive document numbers with toggle reveal.
  - Displays issuing country and expiration dates.
- Verify `PaymentsView`:
  - Renders virtual credit card mockup with automatic brand identification (Visa, Mastercard, Amex, Discover).
  - Masks card numbers and CVV codes with toggle reveal.
  - Formats expiration dates (MM/YYYY) and displays cardholder name and billing address.
- Verify `DocumentsView`:
  - Renders document metadata cards with MIME type indicators and tags.
  - Displays streaming encryption notice for Phase 9 integration.
- Verify `SettingsView`:
  - Displays account profile information (email, device ID, created date).
  - Allows selecting auto-lock timeout duration (5m, 15m, 30m, 60m).
  - Allows applying theme preset tokens (Default, Emerald, Midnight, Nordic, Slate) updating CSS custom properties.
  - Provides local cache inspection and clearing.
- Verify `DevicesView`:
  - Lists active and pending devices.
  - Triggers enrollment challenge creation and displays pairing challenge modal.
  - Prompts for enrollment approval and calls API approval endpoint with challenge signature.
  - Revokes devices on user confirmation.
- Verify `RecoveryView`:
  - Runs in-memory recovery secret validation test against active vault recovery envelope.
  - Exports encrypted JSON backup archive.
  - Imports and verifies encrypted backup package.
- Verify comprehensive Vitest test coverage:
  - 10 automated tests in `apps/vault-web/src/components/views.test.tsx` verifying view rendering, masking, and empty states.
  - All 20 Vitest tests pass in `apps/vault-web`.

## Phase 8 backend sync engine & conflict resolution verification targets

- Verify Go backend sync engine:
  - Delta sync endpoint (`GET /api/v1/vaults/{vaultId}/sync`): returns sync events cursor-paginated with strictly monotonic sequence IDs.
  - Operation submission (`POST /api/v1/vaults/{vaultId}/sync/operations`):
    - Monotonic object revision tracking enforces `new_revision = base_revision + 1`.
    - Idempotency deduplication by `(vault_id, operation_id)` returns the original result without duplicate sequence assignment.
    - Tombstone deletion creates a tombstone revision and emits a delete sync event.
    - Revision mismatch returns RFC 7807 problem details with `409 Conflict`, `currentRevision`, and `attemptedBaseRevision`.
  - Object retrieval (`GET /api/v1/vaults/{vaultId}/objects/{objectId}`): retrieves specific or latest encrypted revisions.
  - Object upsert (`PUT /api/v1/vaults/{vaultId}/objects/{objectId}`): validates `If-Match-Revision` and increments revision.
  - Tenant isolation: requests to vaults of another account return 404 Not Found without leaking object existence or sync state.
- Verify client-side sync engine (`apps/vault-web/src/storage/sync-engine.test.ts`):
  - Delta sync pulls new remote records and applies them to local IndexedDB.
  - Push sync drains pending local operations in FIFO sequence.
  - Server revision conflicts throw `ConflictError` with remote revision details.
  - Keep-local resolution rebases local changes atop the conflicting remote revision and uploads a new revision.
  - Remote tombstone deletion clears local IndexedDB record and applies server cursor.
- Verify conflict resolution UI (`apps/vault-web/src/components/modals/ConflictResolutionModal.test.tsx`):
  - Side-by-side comparison modal displays local and remote fields with clear visual badges.
  - Renders tombstone states when a record was deleted on the server.
  - Invokes resolution callbacks (`onKeepLocal`, `onKeepServer`, `onMerge`) on user action.
- All Phase 8 verification targets pass in `apps/api/internal/router` (`TestSyncEngineAndConflictResolution`, `TestSyncTenantIsolation`) and `apps/vault-web` (`sync-engine.test.ts`, `ConflictResolutionModal.test.tsx`). Total 27 Vitest tests passing in `vault-web`.

## Phase 9 encrypted attachments & object storage verification targets

- Verify streaming AEAD protocol (`packages/crypto-core/test/attachments.test.mjs`):
  - Roundtrip encryption & decryption for empty payloads (55-byte wire format with single `TAG_FINAL` frame).
  - Roundtrip encryption & decryption for small payloads (< 1 MiB).
  - Roundtrip encryption & decryption for multi-chunk payloads (> 1 MiB) with sequential frame authentication.
  - Context binding rejection: mismatched `vaultId`, `objectId`, or `revision` fails authentication closed.
  - Frame tampering rejection: bit-flipping ciphertext bytes throws authentication failure.
  - Truncation rejection: missing `TAG_FINAL` frame fails closed.
  - Attachment key wrapping roundtrip: VEK wraps and unwraps 32-byte secretstream key using AES-256-KW and context HKDF.
- Verify Go backend attachment handlers (`apps/api/internal/router/router_test.go`):
  - Upload session creation (`POST /api/v1/vaults/{vaultId}/attachments/upload-session`): validates 100 MB max size and 32-byte SHA-256 hash.
  - Ciphertext upload (`PUT .../content`): persists encrypted blob and verifies hash.
  - Upload completion (`POST .../complete`): updates attachment metadata record in `attachments` table.
  - Attachment listing (`GET /api/v1/vaults/{vaultId}/attachments`): returns active attachments ordered by creation date.
  - Download session (`GET .../download-session`): returns download URL, expiration, and ciphertext digest.
  - Content download (`GET .../content`): delivers raw encrypted stream matching original upload.
  - Attachment deletion (`DELETE .../{attachmentId}`): soft deletes metadata and removes blob; subsequent retrieval returns 404.
  - Cross-tenant boundary isolation: Account B cannot access, upload, or delete attachments in Account A's vault (returns 404).
- Verify client UI & local storage (`apps/vault-web`):
  - `DocumentsView.test.tsx`: validates empty state rendering, streaming AEAD banner, and upload button state.
  - Total 29 Vitest tests passing in `apps/vault-web`.

## Phase 10 backup and restore verification targets

- Verify cryptographic backup package & integrity manifest (`packages/crypto-core/test/backup.test.mjs`):
  - Full archive roundtrip: `sealBackupPackage` and `openBackupPackage` with records, attachments, key envelopes, and sync cursor.
  - Clean test browser restoration: Unwraps VEK from embedded password and recovery envelopes, decrypting the archive without prior session or local state.
  - Tamper detection negative tests:
    - Ciphertext bit-flipping fails SHA-256 pre-check before decryption (`ciphertext digest mismatch`).
    - Ciphertext length modification fails size check (`size mismatch`).
    - Salt/nonce bit-flipping fails AES-GCM decryption (`decryption failed`).
    - Altered record ciphertext fails manifest check (`record ciphertext hash does not match manifest`).
    - Altered manifest root hash fails manifest integrity check (`manifest root hash does not match`).
  - Total 18 tests passing in `packages/crypto-core`.
- Verify Go backend backup handlers (`apps/api/internal/router/router_test.go`):
  - `TestBackupMetadataLifecycle`: Creates backup snapshot metadata, asserts 201 Created and fields, verifies list ordering (newest snapshot first), and rejects invalid payloads (negative sizes, invalid digests).
  - `TestBackupTenantIsolation`: Cross-tenant access rejection (Account B cannot post or list backup metadata on Account A's vault -> 404).
- Verify client backup engine & safe staging reconciler (`apps/vault-web/src/storage/backup.test.ts`):
  - Exports valid `EncryptedBackupPackage` with correct snapshotId, records, attachments, and SHA-256 digests.
  - Clean browser restore using 256-bit recovery secret restores all records and attachments into an empty database.
  - Clean browser restore using master password restores all records into an empty database.
  - Conflict safeguard: Older backup revisions (rev 2 vs local rev 5) are flagged as `conflict_older` and skipped by default to prevent silent overwriting. Explicit `overwriteConflicts: true` allows user-confirmed overwrite.
  - Corrupt archive rejection: Rejects non-JSON input, invalid schemas, and tampered ciphertexts.
  - `RestoreStagingModal.test.tsx`: Verifies staging table render, summary counts, conflict safeguard warning banner, and force overwrite checkbox.
  - Total 35 Vitest tests passing in `apps/vault-web`.

## Phase 11 Chrome extension verification targets

- Verify origin allowlisting & hostile origin rejection (`apps/extension/src/extension.test.ts`):
  - `normalizeOrigin` extracts protocol and origin; rejects invalid schemes (`javascript:`, `data:`).
  - `extractHostname` extracts hostname; rejects invalid/bare hosts without dots (except `localhost`).
  - `matchesDomain`:
    - Validates exact host match (`recordHost === currentHost`).
    - Validates hierarchical subdomains (`sub.example.com` matches `example.com`).
    - Strictly rejects loose substring matching (e.g. `evil-github.com` vs `github.com`).
    - Strictly rejects suffix spoofing (e.g. `github.com.attacker.com` vs `github.com`).
    - Strictly rejects embedded substring spoofing (`notexample.com` vs `example.com`).
  - `isAllowedOrigin` verifies custom allowed origin allowlists.
- Verify DOM credential filling & non-submission safety (`apps/extension/src/extension.test.ts`):
  - Fills username and password inputs; triggers synthetic `input` and `change` events.
  - Non-submission guarantee: Asserts that `form.submit` is NEVER invoked and no form submission occurs.
  - Gracefully returns `{ success: false }` when no login form exists on the page.
- Verify extension session management & volatile zeroization (`apps/extension/src/extension.test.ts`):
  - Starts in locked state (`isUnlocked: false`, `decryptedRecords: []`).
  - Unlocks with valid master password and Argon2id KDF.
  - Unlocks with 256-bit recovery secret and HKDF-SHA256.
  - Rejects wrong master password and remains locked.
  - Credential listing: Returns sanitized `CredentialSummary[]`; strictly verifies that `password` fields are never included in list summaries.
  - Prioritizes credentials matching the current tab's active domain.
  - Domain mismatch enforcement:
    - Attempting to fill a credential on an unmatching origin (`https://evil-phishing.com` vs `github.com`) throws a domain mismatch error when `allowMismatch: false`.
    - Filling on an unmatching origin succeeds only when `allowMismatch: true` (explicit user confirmation).
    - Rejects filling on non-web schemes (`chrome://settings`).
  - Volatile zeroization: Calling `session.lock()` immediately clears keys, zeroes decrypted cache, and blocks subsequent fills.
- Verify zero credential logging (`apps/extension/src/extension.test.ts`):
  - Spies on `console.log`, `console.info`, `console.warn`, and `console.error`.
  - Verifies that zero passwords, recovery secrets, or raw keys are logged across unlock, listing, fill, or error flows.
- Verify content script frame boundary (`apps/extension/src/extension.test.ts`):
  - Content script definition strictly enforces `allFrames: false` (top-level browsing context only; no injection into child or cross-origin iframes).
- Verify popup UI rendering (`apps/extension/src/popup.test.tsx`):
  - Renders locked view with master password input, unlock button, and demo vault seed option.
  - Total 18 Vitest tests passing in `apps/extension`.

## Later security and product coverage

Follow the master specification's crypto known-answer and negative tests, backend authorization/tenant isolation tests, offline/conflict tests, CMS schema/revision tests, attachment ciphertext checks, extension origin-boundary tests, and end-to-end flows. Round-trip crypto tests alone are insufficient. Do not use production data in tests.
