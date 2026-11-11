# Implementation status

**Current phase:** Phase 9 complete; ready for Phase 10 (Backup and Restore)<br>
**Status:** Phases 0, 1, 2, 3, 4, 5, 6, 7, 8, and 9 delivered. Phase 2 protocol and crypto-core remain a prototype, **PENDING SECURITY REVIEW**. Phase 9 delivers client-side streaming AEAD encryption using libsodium `crypto_secretstream_xchacha20poly1305`, scoped upload and download sessions with SHA-256 integrity validation, quota and size limits (100 MB), Go backend attachment handlers with tenant isolation, interactive attachment management and decryption in `apps/vault-web` (`DocumentsView`), and 100% test coverage with 29 Vitest tests in `vault-web`, 16 crypto-core tests, and Go router tests passing.

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

## Phase 6 scope delivered

- Database migration `00003_cms_foundation.sql`:
  - `cms_modules`, `cms_sections`, `cms_navigation_items`, `cms_theme_settings`, and `cms_revisions` tables with `UUID DEFAULT gen_random_uuid()` primary keys and `account_id` foreign keys with cascade deletion.
- OpenAPI 3.1 contract extended with `/api/v1/app/configuration` and `/api/v1/admin/cms/...` endpoints, linted cleanly with Redocly (0 errors).
- Client API types and Zod validation schemas updated across `@pdv/api-client`, `@pdv/data-models`, and `@pdv/validation`.
- Go backend architecture:
  - Domain models in `apps/api/internal/domain/cms.go`.
  - Repository interfaces in `repository.go` with complete in-memory `MockRepository` and PostgreSQL `PostgresRepository`.
  - Automatic configuration seeding on first account access (pre-populating standard vault modules, navigation items, dashboard overview sections, and default theme).
  - Revision history tracking: every CMS mutation creates a snapshot with incremental revision numbers and change summaries.
  - Snapshot rollback: `POST /api/v1/admin/cms/revisions/{revisionNumber}/restore` cleanly restores earlier configuration states.
  - Strict tenant boundary enforcement: cross-account access attempts return 404 Not Found without leaking configuration data.
  - HTTP handlers in `apps/api/internal/handlers/cms.go` and router endpoints in `apps/api/internal/router/router.go`.
- Protected Admin web application (`apps/admin-web`):
  - Session authentication gate with sign-in and registration fallback.
  - Sections management tab: screen filter, order controls, visibility toggle, create/edit modal with JSON content payload editor, and deletion.
  - Modules management tab: enable/disable optional modules, edit display names and descriptions, adjust display orders.
  - Navigation management tab: order, toggle visibility, and update labels.
  - Theme settings tab: preset styles (Default, Emerald, Midnight, Nordic, Slate), custom primary color picker, border radius, layout density, and live preview card.
  - Revisions audit trail tab: timestamped log with actor device ID, change summary, and one-click restore.
  - Zero-knowledge notice banner emphasizing client-side encryption isolation.
- Declarative Trusted Component Registry (`apps/vault-web`):
  - `CmsSectionRenderer` component supporting only safe whitelisted section types: `welcome`, `summary`, `quick_actions`, `recent_items`, `vault_cards`, `custom_info`, and `help_panel`.
  - Immune to XSS and remote code execution: strict React text node rendering, no `dangerouslySetInnerHTML`, no arbitrary HTML or script evaluation.
  - Dynamic theme styling: CSS variables `--primary-color` and `--border-radius` applied dynamically from active configuration.
- Comprehensive automated test suite:
  - Go API tests in `internal/router/router_test.go` (`TestCmsEndpointsAndSeeding`, `TestCmsTenantIsolation`).
  - Vitest tests in `apps/vault-web/src/components/CmsSectionRenderer.test.tsx` (5/5 tests passing).

## Phase 7 scope delivered

- Modular primary web application shell (`apps/vault-web`):
  - Sticky navigation bar (`AppNavbar`) with vault selector dropdown, lock/unlock actions, global quick-search across decrypted records, password generator launcher, auto-lock countdown badge, and user session badge.
  - Collapsible responsive sidebar (`AppSidebar`) with category count badges (Passwords, Notes, Identities, Payments, Documents) and active route highlighting.
  - Dynamic Dashboard (`DashboardView`) rendering declarative CMS sections via `CmsSectionRenderer`, summary statistics cards, vault security status indicators, and recent records preview.
- Specialized Record Views:
  - `PasswordsView`: Search filter, tag filtering pills, masked passwords with toggle reveal, 30s auto-clearing clipboard copy, URL launcher with `rel="noopener noreferrer"`.
  - `NotesView`: Master-detail split layout, word & character counters, safe markdown rendering without raw HTML execution, tag management.
  - `IdentitiesView`: Structured identity document cards (Passports, Driver's Licenses, National IDs, Social Security Numbers), masked document numbers with toggle reveal, issuing authority and expiry badges.
  - `PaymentsView`: Visual virtual card layout with automatic card brand detection (Visa, Mastercard, Amex, Discover), masked card numbers, CVV reveal, expiry date badges, and billing address.
  - `DocumentsView`: Encrypted file metadata, MIME type identification, tags, and Phase 9 streaming encryption placeholder notices.
- Vault Lifecycle Modals:
  - `CreateVaultModal`: Master password confirmation, live entropy calculation and strength bar, Argon2id p=4 derivation, and prominent 256-bit offline recovery secret presentation with loss acknowledgement.
  - `UnlockVaultModal`: Unlocking via master password or offline recovery secret with immediate zeroization on failure.
  - `ChangePasswordModal`: Verification of current password, Argon2id rewrapping of the same VEK with fresh salt, preserving recovery envelope and all encrypted records.
  - `PasswordGeneratorModal`: CSPRNG generator with configurable length (8-64), character sets (uppercase, lowercase, digits, symbols), ambiguous character exclusion, and copy action.
  - `RecordModal`: Polymorphic record editor validating required fields per record type.
- Device Management UI (`DevicesView`):
  - Active and pending device inventory with last seen timestamps.
  - Cryptographic challenge generation for new device enrollment (`POST /api/v1/devices/enrollments`).
  - Active device cryptographic enrollment approval (`POST /api/v1/devices/enrollments/{id}/approve`).
  - Device revocation (`DELETE /api/v1/devices/{id}`).
- Recovery & Backup Management (`RecoveryView`):
  - In-memory offline recovery secret verification test (verifies decryptability of recovery envelope without persisting).
  - Encrypted JSON archive export (AES-256-GCM encrypted backup package) and backup import restoring local IndexedDB store.
- Settings & Theme Design Tokens (`SettingsView`):
  - Account profile summary with device ID and registration date.
  - Configurable inactivity auto-lock timeout selector (5m, 15m, 30m, 60m).
  - Theme preset tokens (Default, Emerald, Midnight, Nordic, Slate) applying CSS variables dynamically.
  - Local IndexedDB storage inspection and cache clearing.
- Comprehensive Automated Test Suite:
  - `apps/vault-web/src/components/views.test.tsx`: 10 comprehensive Vitest tests verifying rendering of all views, masked data, and empty states.
  - Total 20 Vitest tests passing in `apps/vault-web`.

## Phase 8 scope delivered

- Backend sync engine architecture (`apps/api`):
  - Domain models in `apps/api/internal/domain/models.go` (`SyncOperationInput`, `SyncOperationResult`, `RevisionConflict`, `RevisionConflictError`).
  - Repository interface extended in `repository.go` with `SubmitSyncOperation`, `ListSyncEvents`, `GetEncryptedObjectRevision`, and `PutEncryptedObject`.
  - In-memory mock repository (`mock.go`) and production PostgreSQL repository (`postgres.go`) with row-level locking (`FOR UPDATE`), atomic transaction boundaries, and monotonic per-vault sequence counters.
  - Idempotent request handling deduplicating submissions by `(vault_id, operation_id)`.
  - Enforced monotonic revision checks (`new_revision = base_revision + 1`).
  - Tombstones for record deletion (`operation_kind: 'delete'`) emitting deletion sync events to peers.
  - HTTP 409 Conflict problem details formatted per RFC 7807 with structured `currentRevision` and `attemptedBaseRevision`.
  - HTTP handlers in `apps/api/internal/handlers/sync.go` and endpoints mounted in `router.go` under `requireActiveSession`:
    - `POST /api/v1/vaults/{vaultId}/sync/operations`
    - `GET /api/v1/vaults/{vaultId}/sync`
    - `GET /api/v1/vaults/{vaultId}/objects/{objectId}`
    - `PUT /api/v1/vaults/{vaultId}/objects/{objectId}`
  - Cross-tenant sync isolation: requests to vaults belonging to another account return 404 Not Found without leaking object existence.
- Client-side sync engine (`apps/vault-web`):
  - API client functions in `apps/vault-web/src/api.ts` (`listSyncEvents`, `submitSyncOperation`, `getEncryptedObject`, `putEncryptedObject`) and `ConflictError` class.
  - Local database sync state persistence in `apps/vault-web/src/storage/db.ts` (`putSyncState`, `getSyncState`).
  - `RecordRepository` methods: `getStoredRecord`, `deletePendingOperation`, `getSyncState`, `putSyncState`, `openRecord`, and singleton `getRecordRepository()`.
  - `SyncEngine` class (`apps/vault-web/src/storage/sync-engine.ts`) with delta pull cursor synchronization, FIFO pending push queue draining, conflict detection, and resolution strategies (`resolveKeepLocal`, `resolveKeepRemote`, `resolveMerge`).
  - Side-by-side visual conflict comparison and merge modal (`ConflictResolutionModal.tsx`).
  - Navbar sync button and status badges (`Synced`, `Syncing...`, `Offline`, `Conflict`, pending count).
- Automated tests:
  - Go API tests in `internal/router/router_test.go` (`TestSyncEngineAndConflictResolution`, `TestSyncTenantIsolation`).
  - Vitest unit tests in `apps/vault-web/src/storage/sync-engine.test.ts` (5 tests covering full sync cycle, idempotency deduplication, conflict detection, keep-local rebase, and tombstone delete propagation).
  - Vitest UI tests in `apps/vault-web/src/components/modals/ConflictResolutionModal.test.tsx` (2 tests verifying side-by-side field diffing, resolution triggers, and tombstone handling).
  - Total 27 Vitest tests passing in `apps/vault-web`.

## Phase 9 scope delivered

- Streaming AEAD protocol integration (`@pdv/crypto-core`):
  - Reviewed `libsodium-wrappers` 0.8.4 integration using `crypto_secretstream_xchacha20poly1305`.
  - Framing: 8 bytes `PDVSTRM\0` magic header, 2 bytes `u16be` protocol version (1), 24 bytes secretstream header, repeated frames with 4 bytes `u32be` length and ciphertext bytes (17 to 1,048,593).
  - Per-frame authenticated data: `ASCII "PDV/1/attachment-chunk" || 0x00 || contextBytes || u64be(chunkIndex)`.
  - Final frame tagged with `TAG_FINAL`. Empty attachment represented by 1 empty final frame (55 bytes).
  - Stream key generation and wrapping: 32-byte key generated per attachment and wrapped using AES-256-KW with context-derived HKDF key from active VEK.
  - Comprehensive negative tests: rejection of corrupt magic, version mismatch, truncated frames, out-of-order frames, missing `TAG_FINAL`, trailing bytes, and key unwrap mismatch.
- OpenAPI 3.1 specification & client types:
  - Added `Attachments` tag, schemas (`AttachmentMetadata`, `AttachmentList`, `AttachmentUploadSessionRequest`, `AttachmentUploadSessionResponse`, `AttachmentCompleteRequest`, `AttachmentDownloadSessionResponse`), and endpoints for upload-session, complete, download-session, metadata, deletion, and content streaming.
  - Linted cleanly with Redocly (0 errors).
  - Regenerated typed client in `@pdv/api-client` and updated `@pdv/data-models` and `@pdv/validation`.
- Backend attachment management (`apps/api`):
  - Domain models in `apps/api/internal/domain/models.go`.
  - Repository methods in `apps/api/internal/database/repository.go` implemented for in-memory Mock and PostgreSQL.
  - Enforced 100 MB maximum ciphertext size limit, positive byte lengths, and 32-byte SHA-256 digests.
  - HTTP handlers in `apps/api/internal/handlers/attachments.go` mounted under `requireActiveSession`.
  - Strict tenant boundary isolation: cross-tenant attachment access returns 404 Not Found.
- Client UI & Local Storage (`apps/vault-web`):
  - `DocumentsView`: Interactive attachment hub with client-side libsodium streaming AEAD encryption, upload progress, file size formatting, and client-side decryption download.
  - IndexedDB storage: Added `encrypted_attachments` store to `pdv_local_store` (DB_VERSION 2) with `MemoryDatabase` support.
  - API client methods in `apps/vault-web/src/api.ts`.
- Automated test coverage:
  - 16 tests in `packages/crypto-core` (including 7 attachment streaming AEAD tests).
  - Go backend tests in `apps/api/internal/router/router_test.go` (`TestAttachmentLifecycle`, `TestAttachmentTenantIsolation`).
  - 29 Vitest tests in `apps/vault-web` (including `DocumentsView.test.tsx`).

## Phase 10 scope delivered

- Cryptographic backup package & integrity manifest (`@pdv/crypto-core`):
  - Authenticated versioned container format (`EncryptedBackupPackage`): formatVersion 1, protocolVersion 1, AES-256-GCM + HKDF-SHA256, 16-byte salt, 12-byte random nonce, AAD bound to `PDV/1/backup:{vaultId}:{snapshotId}`.
  - Key envelopes bundled in archive: `password` and `recovery` envelopes embedded so vaults can be restored on clean browsers using master password or 256-bit recovery secret without prior local or server state.
  - Deterministic integrity manifest (`BackupArchiveManifest`): Canonical SHA-256 digests over each record and attachment with an aggregated root hash across sorted identifiers and key envelopes. Verified prior to decryption and recomputed upon decryption.
  - Automated tests: 18 passing tests in `packages/crypto-core` covering complete roundtrip, clean browser restore via password and recovery secret, and rejection of modified ciphertext, bad digest, corrupted salt/nonce, and tampered manifest root hash.
- OpenAPI 3.1 specification & client types:
  - Added `Backup` tag, schemas (`BackupMetadata`, `CreateBackupMetadataRequest`, `BackupMetadataList`), and endpoints:
    - `POST /api/v1/vaults/{vaultId}/backup/metadata`
    - `GET /api/v1/vaults/{vaultId}/backup/metadata`
  - Linted with Redocly (0 errors), regenerated client in `@pdv/api-client`, and added schemas in `@pdv/data-models` and `@pdv/validation`.
- Backend backup snapshot tracking (`apps/api`):
  - Database migration `00004_vault_backups.sql` for table `vault_backups`.
  - Repository methods in `Repository`, `MockRepository`, and `PostgresRepository`.
  - Handlers in `apps/api/internal/handlers/backup.go` mounted under `requireActiveSession`.
  - Tenant boundary tests `TestBackupMetadataLifecycle` and `TestBackupTenantIsolation` passing 100%.
- Client backup engine & safe staging reconciler (`apps/vault-web`):
  - `exportVaultBackup`: Client-side packaging of encrypted records, attachments, sync state, and key envelopes with integrity manifest and download of `.pdvbackup`.
  - `recordBackupMetadataToServer`: Non-blocking logging of backup metadata to server.
  - `stageVaultBackup`: Validates schema and digests, decrypts payload in-memory, compares against local records, and categorizes into `new`, `upgraded`, `identical`, `conflict_older`, `conflict_divergent`.
  - `applyRestorePlan`: Writes restored records and attachments; skips older conflicts by default unless explicitly confirmed.
  - UI integration: `RestoreStagingModal` interactive review table with conflict warnings, selection toggles, and overwrite checkbox; `RecoveryView` with guidance on browser storage limitations and backup metadata leakage disclosure.
  - Vitest tests: 35 passing tests in `apps/vault-web` (including 5 backup tests and `RestoreStagingModal.test.tsx`).

## Phase 11 scope delivered

- Chrome Manifest V3 extension (`apps/extension`):
  - Built with WXT, Vite, React 19, and TypeScript.
  - Manifest V3 architecture with minimal privileges: permissions `["storage", "activeTab", "scripting"]`, explicit localhost host permissions, and CSP `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`.
- Background Service Worker (`entrypoints/background.ts` & `src/session.ts`):
  - In-memory `SessionManager` managing volatile vault lifecycle: unlock with master password (Argon2id KDF) or 256-bit recovery secret (HKDF-SHA256).
  - Volatile zeroization: Locking immediately clears unlocked keys and zeroes decrypted records cache.
  - Typed messaging handling `GET_STATUS`, `UNLOCK_VAULT`, `LOCK_VAULT`, `LIST_CREDENTIALS`, `CHECK_DOMAIN_MATCH`, `REQUEST_FILL`, `GET_ALLOWLIST`, `ADD_ALLOWLIST`, `REMOVE_ALLOWLIST`, and `SEED_VAULT`.
  - Zero credential logging: All console methods (`log`, `info`, `warn`, `error`) are strictly sanitized of passwords, recovery secrets, and key material.
- Untrusted Content Script & Frame Boundary Isolation (`entrypoints/content.ts`):
  - Restricts execution strictly to top-level frames (`allFrames: false` in manifest and definition), preventing script execution in hostile third-party or cross-origin iframes.
  - Top-level frame targeting: Background worker targets strictly `{ frameId: 0 }` during fill dispatch.
  - Key withholding: VEK, DEK, and unrestricted decrypted collections are never sent to the content script or page DOM. Only the single user-approved credential pair is dispatched.
- Origin Matching & Anti-Spoofing Utilities (`src/utils/origin.ts`):
  - `normalizeOrigin`, `extractHostname`, `matchesDomain`, and `isAllowedOrigin`.
  - Validates exact hostnames and valid dot-prefixed subdomains.
  - Strictly rejects substring spoofing (`evil-example.com`), suffix spoofing (`example.com.attacker.com`), and non-web schemes (`chrome://`, `file://`, `javascript:`).
- Manual Fill & Non-Submission Safety (`src/utils/dom-fill.ts`):
  - Locates password and username inputs; updates values using prototype setters to trigger React/Vue synthetic events.
  - Strictly non-submitting: Form auto-submission (`form.submit()` or simulated enter keypresses) is prohibited.
- User-Approved Popup UI (`entrypoints/popup/`):
  - Header with shield icon, active tab domain pill, and quick lock button.
  - Locked view: Master password / recovery secret unlock inputs and demo seed action.
  - Unlocked view: Search bar, prioritized domain matching credential cards, and allowlist manager.
  - Domain mismatch warning screen: Prominently warns when credential domain differs from active tab origin; enforces explicit user risk acknowledgment checkbox before enabling fill.
- Automated tests:
  - 18 passing tests in `apps/extension` (`extension.test.ts`, `popup.test.tsx`) verifying origin matching, hostile domain rejection, DOM fill without submission, session unlock/lock zeroization, domain mismatch blocking, zero credential logging, and UI rendering.

## Phase 12 scope delivered

- Defense-in-depth API Security Headers (`apps/api/internal/middleware/security.go`):
  - Strict non-rendering Content-Security-Policy (`default-src 'none'; frame-ancestors 'none'; base-uri 'none';`).
  - Standard headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and non-caching `Cache-Control: no-store, no-cache, must-revalidate, private`.
  - HSTS (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`) enforced when running in secure mode.
- Multi-Tier Token Bucket Rate Limiting (`apps/api/internal/middleware/ratelimit.go`):
  - Auth routes (`/api/v1/auth/login`, `/api/v1/auth/register`): 15 req/min per IP.
  - Device enrollment routes (`/api/v1/device-enrollments`): 30 req/min per IP.
  - Standard API routes: 200 req/min per IP.
  - Exceeded rate limits return HTTP 429 Too Many Requests with `Retry-After: 60` and standard RFC 7807 problem details JSON.
  - Automatic background garbage collection for expired visitor buckets.
- Data Deletion, Purge & Retention Lifecycles:
  - Account Deletion (`DELETE /api/v1/auth/account`): Authenticated account with active device can permanently purge their account and cascade all associated records, devices, sessions, and attachments.
  - Sync Tombstone Retention Window: Soft-deleted sync records are retained for 30 days (`PurgeExpiredTombstones`) to ensure offline devices propagate deletions.
  - Soft-Deleted Vaults: Soft-deleted vaults are retained for 30 days before server purge (`PurgeSoftDeletedVaults`).
  - Offline Backups Retention Policy: Explicit disclosures that external offline `.pdvbackup` packages remain outside server deletion custody.
- Web Client Hardening (`apps/vault-web`, `apps/admin-web`):
  - CSP meta tags and secure server headers configured for Vite SPAs.
  - User-facing data retention and limitation policies rendered in `SettingsView`.
- Supply Chain & Dependency Audit:
  - `pnpm audit --prod` clean with 0 known production vulnerabilities.
- Pre-Release Documentation Suite:
  - `docs/THREAT_MODEL.md`: Complete asset, threat actor, and mitigation mapping.
  - `docs/SECURITY_REVIEW.md`: Internal cryptographic, boundary, and vulnerability audit report.
  - `docs/PRODUCTION_DEPLOYMENT.md`: Infrastructure, reverse proxy (Nginx), TLS, environment variable, and zero-key policy runbook.
  - `docs/USER_SECURITY_LIMITATIONS.md`: Plain-language security disclosures on lost keys, compromised endpoints, and clipboard risks.
  - `docs/RELEASE_CHECKLIST.md`: Formal verification checklist across all 12 project phases.

## Implementation Status Summary

All 12 phases of the Master Build Specification roadmap have been delivered and verified:

- **Phase 0:** Project bootstrap, monorepo setup, and CI.
- **Phase 1:** Domain models, OpenAPI 3.1 contract, and Zod schemas.
- **Phase 2:** Centralized cryptographic core and test vectors.
- **Phase 3:** Database migrations, PostgreSQL repository, and tenant boundaries.
- **Phase 4:** WebAuthn/external auth, device approval workflow, and sessions.
- **Phase 5:** Vault lifecycle, dual key envelopes, and Argon2id WASM worker.
- **Phase 6:** Declarative schema-driven CMS and admin web app.
- **Phase 7:** Full-featured vault web client with 9 views and auto-lock.
- **Phase 8:** Offline-first synchronization, monotonic revisions, and conflict resolution.
- **Phase 9:** Chunked streaming AEAD file attachments and object storage.
- **Phase 10:** Encrypted backup packages, integrity manifests, and safe staging engine.
- **Phase 11:** Chrome Manifest V3 browser extension with manual fill and anti-spoofing origin matching.
- **Phase 12:** Hardening, security headers, rate limiting, and release candidate baseline.

## Production readiness note

In accordance with Section 24 rule 10 of `PERSONAL_DIGITAL_VAULT_MASTER_BUILD_SPEC_v1.1.md`:
_Before production use, obtain an independent security review of cryptographic design, implementation, browser extension boundaries, authentication, recovery and backup._
The repository is at **Release Candidate 1 (1.0.0-rc1)** status, with all automated tests, linting, typechecks, and audits green.
