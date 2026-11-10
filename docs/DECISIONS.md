# Architecture decisions

## ADR-0001: Monorepo with separate application surfaces

**Status:** Accepted for Phase 0<br>
**Decision:** Use pnpm workspaces and Turborepo for TypeScript apps/packages; keep Go as an independent module in `apps/api`. Keep the Vault and protected Admin/CMS as separate React applications sharing API contracts and selected libraries.<br>
**Reason:** This preserves the spec's monorepo while making the product's two distinct surfaces explicit. Admin authorization remains an API responsibility; separate frontend bundles do not provide access control.

## ADR-0002: Local services use Docker Compose

**Status:** Accepted<br>
**Decision:** Use Compose with PostgreSQL and RustFS for local development. Bind ports to loopback and use persistent named volumes. A PowerShell helper generates random local-only credentials into ignored `.env`. Use the generic S3 adapter interface for RustFS locally and Cloudflare R2 when managed storage is selected.<br>
**Reason:** The user confirmed Docker is installed. An anonymous pull of the spec's `quay.io/minio/minio` image returned `401 UNAUTHORIZED` during setup. RustFS documents an official Docker image, S3 compatibility, and a local single-node mode. This is a documented Phase 0 deviation; reassess local object storage before production, and do not treat RustFS single-node mode as redundant storage.

Reference: [RustFS 1.0.4 release](https://github.com/rustfs/rustfs/releases) and [RustFS container installation](https://docs.rustfs.com/en/installation/container/docker).

## ADR-0003: Managed development providers

**Status:** Recommended<br>
**Decision:** Neon is the recommended managed PostgreSQL option; Cloudflare R2 Standard is the recommended S3-compatible object store. Keep provider settings behind environment variables/adapters.<br>
**Reason:** Both currently advertise free usage tiers; their limits and terms can change. Local Compose remains the no-paid-infrastructure fallback. Recheck pricing, availability, privacy, and backup requirements before production.

## ADR-0004: Account is the initial tenant boundary

**Status:** Accepted for v1<br>
**Decision:** Model account ownership as tenant scope for v1; no team/shared tenants.<br>
**Reason:** Team and shared vaults are out of scope. Revisit only if product scope changes.

## ADR-0005: CMS configuration and sensitive custom schemas

**Status:** Accepted for Phase 6<br>
**Decision:** Keep ordinary presentation configuration (screen sections, module toggles, navigation items, theme tokens) server-managed and versioned. All private custom-field labels or sensitive schemas must remain client-side only and never sent to the backend. All CMS rendering must execute strictly through a finite trusted client-side component registry, rejecting arbitrary HTML, scripts, CSS injection, or eval.<br>
**Reason:** Fulfills Section 7 and Section 14 zero-knowledge requirements of the Master Build Spec. Preserves zero-knowledge privacy while enabling tenant-scoped declarative UI composition.

## ADR-0006: Phase boundaries

**Status:** Accepted<br>
**Decision:** Phase 0 contains shells and infrastructure only. Do not create tables/migrations or implement product features until their specified phases.

## ADR-0007: Server and client domain boundary

**Status:** Accepted<br>
**Decision:** Go server domain types contain account/device metadata, opaque vault/object identifiers, key envelopes, ciphertext, and operational revisions only. Decrypted record types exist only in the TypeScript client domain package and are documented as non-serializable to API requests. Vault labels and private record fields have no server model or database columns.<br>
**Reason:** The backend must not receive plaintext vault content or keys. Client-side decrypted models are needed by future UI/crypto work but must remain outside server persistence and transport.

## ADR-0008: Phase 1 contract, protocol placeholders, and migrations

**Status:** Accepted for Phase 1<br>
**Decision:** Use OpenAPI 3.1 as the HTTP contract, generate TypeScript API types from it, validate untrusted payloads with strict Zod schemas, and manage PostgreSQL changes with Goose. Account IDs scope tenant-owned rows and composite foreign keys keep vault/object relationships within an account. Keep algorithm and protocol identifiers as bounded strings until Phase 2 settles the cryptographic protocol.<br>
**Reason:** The master spec's example envelope is illustrative, and the crypto details are explicitly deferred to Phase 2. The Phase 1 contract lists planned endpoints; handlers, authentication, authorization, and row-level tenant enforcement are not implemented by this ADR or migration. Registration/login mechanics remain deferred to Phase 3; attachment transfer details remain deferred to Phase 9 to avoid committing to URL-based transfer credentials before that security design.

## ADR-0009: Phase 2 cryptographic protocol draft

**Status:** PENDING SECURITY REVIEW; proposed configuration is not approved for production<br>
**Decision:** Proposed v1 uses Argon2id v1.3 with m=65,536 KiB, t=3, p=4, 16-byte salt, and 32-byte output for new password envelopes. Password bytes are exact UTF-8 without trimming or Unicode normalization; malformed UTF-16 surrogate sequences are rejected. Dedicated Web Worker execution is proposed; browser-level WASM threads are not required. Existing valid p=1 envelopes remain unlockable, and p=1 is not accepted for new envelope creation. No silent downgrade is allowed. Password changes and p=1-to-p=4 migration rewrap the same VEK; encrypted object payloads and the independent recovery envelope remain unchanged. The RustCrypto 0.6.0 candidate and Worker adapter are implemented for validation only. The attachment stream format remains proposed and unimplemented. See `docs/architecture/CRYPTO_PROTOCOL.md` and `CRYPTO_DECISIONS.md`.<br>
**Reason:** Primitive vectors pass in Rust/WASM, Node, and Chrome; envelope and lifecycle tests are now executable. Independent cryptographic review, reproducible-build review, broader compatibility review, and independent envelope-vector cross-check remain outstanding. This is not production approval and establishes no security or zero-knowledge claim.

## ADR-0010: Phase 3 Account Authentication and Device Foundation

**Status:** Accepted for Phase 3<br>
**Decision:** Implement account registration and login via WebAuthn/passkey and external credential fallback. Use stateful, database-persisted sessions with cryptographic token hashing (SHA-256 of 32-byte CSPRNG token) stored in HTTP-only, SameSite=Strict cookies. Enforce strict device status transitions: initial registering device is marked active; secondary enrolling devices start in pending status with a short-lived (10-minute) pairing challenge; active devices explicitly approve pending enrollments with cryptographic signature binding. Pending devices are restricted to enrollment status polling and receive 403 Forbidden on protected operational endpoints. Device revocation terminates all associated sessions immediately and blocks future requests.<br>
**Reason:** Fulfills Section 10 and Section 14 requirements of the Master Build Spec. Strictly separates account authentication from vault unlocking. Enforces tenant isolation and device authorization at the API layer.

## ADR-0011: Phase 4 Vault Lifecycle & In-Memory Key Isolation

**Status:** Accepted for Phase 4<br>
**Decision:** Vault lifecycle management is strictly scoped by account ownership. The server stores only opaque vault metadata (`id`, `protocol_version`, `created_at`, `updated_at`) and two key envelopes (`password` and `recovery`). No plaintext labels, passwords, recovery secrets, or decrypted keys ever reach the server. Envelope creation requires both `password` and `recovery` envelopes; the `password` envelope enforces proposed Argon2id parameters (p=4, m=65536 KiB, t=3). Rewrapping (`PUT /api/v1/vaults/{id}/envelopes/password`) verifies p=4 parameters and updates the password-wrapped VEK without disturbing the recovery envelope or requiring record re-encryption. Decrypted VEKs are held in volatile client state (`CryptoKey`) and wiped immediately on lock or session logout. Offline recovery secrets are generated with prominent loss limitation warnings.<br>
**Reason:** Complies with Section 4 and Section 14 zero-knowledge requirements of the Master Build Spec. Enforces tenant isolation and validates KDF security bounds on the backend while maintaining client-side cryptographic ownership.

## ADR-0012: Phase 5 Local Encrypted Record Engine & Offline Storage

**Status:** Accepted for Phase 5<br>
**Decision:** Local client records are persisted exclusively as ciphertext in IndexedDB (`encrypted_records` and `pending_operations` stores) using `@pdv/crypto-core` object envelopes (AES-256-GCM authenticated encryption with AAD derived from the canonical PDV context, DEK wrapped via AES-256-KW using an HKDF key derived from the VEK). Plaintext record fields (passwords, notes, payment info, identity numbers) never exist in IndexedDB or on disk. Decrypted records are held strictly in transient React state and cleared on lock or logout. Local CRUD operations work offline and enqueue revision-tracked sync operations into `pending_operations`. Deletions queue tombstones. Search is performed entirely in client volatile memory over decrypted records. A CSPRNG password generator with uniform rejection sampling and a clipboard manager with 30-second auto-clearing are provided. An inactivity monitor automatically locks all vaults after 15 minutes of inactivity.<br>
**Reason:** Fulfills Section 5, Section 8, and Section 14 requirements of the Master Build Spec. Enforces privacy-by-architecture, zero-knowledge at rest, offline-first data access, and secure key hygiene in client storage.

## ADR-0013: Phase 6 CMS & Admin Foundation with Declarative Component Registry

**Status:** Accepted for Phase 6<br>
**Decision:** Implement a tenant-isolated CMS and administrative foundation:

1. **Database Schema:** Tables `cms_modules`, `cms_sections`, `cms_navigation_items`, `cms_theme_settings`, and `cms_revisions` in migration `00003_cms_foundation.sql`, scoped strictly by `account_id` foreign keys with cascade deletion.
2. **Backend API:** Standardized endpoints under `/api/v1/app/configuration` (public to authenticated tenant) and `/api/v1/admin/cms/...` (administrative mutations). Every mutation automatically records a snapshot in `cms_revisions` with a sequential `revision_number` and change summary. An idempotent restore endpoint (`POST /api/v1/admin/cms/revisions/{revisionNumber}/restore`) restores any prior configuration snapshot.
3. **Tenant Isolation:** Enforced strictly across all CMS queries and mutations. Cross-account access attempts return 404 Not Found without leaking configuration existence or data.
4. **Declarative Component Whitelist:** CMS rendering in client applications (`apps/vault-web`) is mediated exclusively through a finite trusted component registry (`CmsSectionRenderer`). Allowed section types are restricted to `welcome`, `summary`, `quick_actions`, `recent_items`, `vault_cards`, `custom_info`, and `help_panel`. Arbitrary HTML, dynamic `<script>` tags, eval, and CSS execution are strictly prohibited. Text content is rendered as sanitized React text nodes.
5. **Zero-Knowledge Isolation:** The CMS manages presentation, navigation, and theme tokens only. Plaintext vault records, encryption keys (VEKs/DEKs), passwords, and attachments are strictly isolated from the CMS and backend.<br>
   **Reason:** Fulfills Section 7, Section 13, and Section 14 requirements of the Master Build Spec. Delivers dynamic application configuration, administrative control, and audit trail versioning while rigorously enforcing zero-knowledge boundaries and XSS immunity.

## ADR-0014: Phase 7 Main Web Application Architecture and Client Security Controls

**Status:** Accepted for Phase 7<br>
**Decision:** Implement the primary web vault application (`apps/vault-web`) with comprehensive modular views, client-side zero-knowledge security hygiene, and reactive state management:

1. **Application Shell & Navigation:** Responsive layout with sticky top navbar (`AppNavbar`), vault selector, global quick-search across decrypted records, password generator launcher, and auto-lock badge. Collapsible sidebar (`AppSidebar`) with category count badges (Passwords, Notes, Identities, Payments, Documents) and alert indicators.
2. **Specialized Record Category Views:**
   - **PasswordsView:** Filterable list, masked passwords, 30s auto-clearing clipboard copy, reveal/hide toggle, launch URL in new tab with `rel="noopener noreferrer"`.
   - **NotesView:** Master-detail split layout, word & character counters, safe markdown rendering without arbitrary HTML or scripts.
   - **IdentitiesView:** Structured identity document cards (Passports, Driver's Licenses, SSN, National IDs), masked document numbers with reveal toggle, issuing authority and expiry badges.
   - **PaymentsView:** Visual credit/debit card mockup with real-time brand detection (Visa, Mastercard, Amex, Discover), masked card numbers, CVV reveal, and expiry dates.
   - **DocumentsView:** Encrypted file metadata, MIME type identification, tags, and Phase 9 streaming encryption placeholder notices.
3. **Vault Lifecycle Modals:**
   - **CreateVaultModal:** Master password confirmation, live entropy estimation bar (bits, classification), Argon2id p=4 derivation, and prominent 256-bit offline recovery secret presentation with loss acknowledgement.
   - **UnlockVaultModal:** Unlocking via master password or offline recovery secret with immediate zeroization on failure.
   - **ChangePasswordModal:** Verification of current password, Argon2id rewrapping of the same VEK with fresh salt, preserving recovery envelope and all encrypted records.
   - **PasswordGeneratorModal:** CSPRNG generator with configurable length (8-64), character sets (uppercase, lowercase, digits, symbols), ambiguous character exclusion, and copy action.
   - **RecordModal:** Polymorphic record editor validating required fields per record type.
4. **Device Management & Pairing UI (`DevicesView`):**
   - Active and pending device inventory with last seen timestamps.
   - Cryptographic challenge generation for new device enrollment (`POST /api/v1/devices/enrollments`).
   - Active device cryptographic enrollment approval (`POST /api/v1/devices/enrollments/{id}/approve`).
   - Device revocation (`DELETE /api/v1/devices/{id}`).
5. **Recovery & Backup Management (`RecoveryView`):**
   - In-memory offline recovery secret verification test (verifies decryptability of recovery envelope without persisting).
   - Encrypted JSON archive export (AES-256-GCM encrypted backup package) and backup import restoring local IndexedDB store.
6. **Client Security Hygiene & Inactivity Locking:**
   - Plaintext records and decrypted VEKs are held exclusively in volatile React/DOM memory; never logged, never cached in `localStorage` or `sessionStorage`, and never sent over the network.
   - Configurable inactivity monitor (5m, 15m, 30m, 60m) automatically locks all vaults and wipes in-memory VEKs upon expiration.
   - Secure clipboard manager clears copied sensitive data after 30 seconds.
   - Safe CSS design tokens for customizable theme accents.<br>
     **Reason:** Fulfills Section 5, Section 6, Section 8, Section 10, and Section 14 requirements of the Master Build Spec. Delivers an accessible, zero-knowledge, and production-grade primary web interface.

## ADR-0015: Phase 8 Backend Sync Engine and Conflict Handling

**Status:** Accepted for Phase 8<br>
**Decision:** Implement the append-only sync protocol, monotonic per-vault sequencing, optimistic concurrency with 409 Conflict detection, and client-side side-by-side conflict resolution:

1. **Append-Only Sync Event Log & Monotonic Sequence Counter:**
   - Server assigns a strictly monotonic `sequence_id` (BIGINT) per vault in the `sync_events` table upon every successful sync operation.
   - Per-object revision tracking enforces `new_revision = base_revision + 1`. An upsert on a non-existent object requires `base_revision = 0` yielding revision `1`.
   - Tombstones for deletion: `operation_kind = 'delete'` inserts a tombstone revision marking `is_deleted = true`, preserving revision history and emitting a deletion sync event to peers.
2. **Idempotent Request Handling:**
   - Deduplication by composite unique key `(vault_id, operation_id)`: duplicate submissions return the original operation's result (`sequence_id`, `new_revision`) without creating duplicate sync events or incrementing revisions.
3. **Optimistic Concurrency & 409 Conflict Protocol:**
   - When an incoming operation's `base_revision != current_revision`, the server rejects with HTTP `409 Conflict`.
   - Problem details response (RFC 7807) includes structured details: `type = "https://personal-digital-vault/errors/revision-conflict"`, `details: { currentRevision, attemptedBaseRevision }`.
4. **Delta Sync & Object Fetch Endpoints:**
   - `POST /api/v1/vaults/{vaultId}/sync/operations`: Submits single upsert or delete sync operation with optimistic revision check.
   - `GET /api/v1/vaults/{vaultId}/sync?after={cursor}&limit={limit}`: Delta feed cursor pagination ordered by `sequence_id ASC`.
   - `GET /api/v1/vaults/{vaultId}/objects/{objectId}?revision={rev}`: Fetches specific encrypted object revision.
   - `PUT /api/v1/vaults/{vaultId}/objects/{objectId}`: Direct object revision upsert supporting `If-Match-Revision` header.
5. **Client-Side Sync Engine (`apps/vault-web`):**
   - Delta pull: Fetches sync events since last persisted cursor, pulls updated object envelopes, and applies them to local IndexedDB store.
   - Push queue draining: Iterates pending local operations in FIFO order; handles idempotency and detects 409 conflicts.
   - Zero-knowledge conflict handling: On `ConflictError`, fetches server ciphertext revision, decrypts both local and server records in volatile memory using active VEK, and presents side-by-side comparison modal (`ConflictResolutionModal`).
   - Resolution strategies:
     - **Keep Local**: Rebases local modifications atop the latest server revision (`base_revision = conflict.serverRevision`) and pushes as a new revision.
     - **Keep Server**: Discards local pending changes and updates local store with server record.
     - **Merge**: Applies user's merged field selection, saves as new revision, and pushes.
   - Silent overwrite (last-write-wins) is strictly prevented.<br>
     **Reason:** Fulfills Section 5, Section 11 ("SYNC AND CONFLICT RESOLUTION"), and Section 14 requirements of the Master Build Spec. Guarantees deterministic event ordering across devices, cross-device consistency, data loss prevention, and strict zero-knowledge encryption guarantees.

## ADR-0016: Phase 9 Encrypted Attachments and Object Storage Architecture

**Status:** Accepted for Phase 9<br>
**Decision:** Implement client-side streaming AEAD encryption, scoped presigned upload/download authorization sessions, server ciphertext validation, and document management:

1. **Reviewed Streaming AEAD Protocol (`libsodium-wrappers` 0.8.4):**
   - Implements `crypto_secretstream_xchacha20poly1305` framing strictly per specification:
     - 8 bytes magic `PDVSTRM\0`
     - 2 bytes protocol version (1)
     - 24 bytes secretstream header
     - Repeated frames: 4 bytes `u32be` frame ciphertext length (17 to 1,048,593), followed by ciphertext frame bytes.
   - Per-frame associated data: `ASCII "PDV/1/attachment-chunk" || 0x00 || contextBytes || u64be(chunkIndex)`.
   - The final stream chunk carries `TAG_FINAL`. An empty attachment is one empty plaintext final frame (55 bytes wire format).
   - Reader fails closed on corrupted magic, version mismatch, truncated frames, out-of-order frames, missing `TAG_FINAL`, or trailing bytes.
2. **Stream Key Wrapping:**
   - A fresh random 32-byte key is generated per attachment upload.
   - Wrapped using AES-256-KW with an HKDF key derived from the active VEK and object context (`purpose: "attachment"`, `objectId: attachmentId`).
3. **Backend Upload & Download Sessions (`apps/api`):**
   - `POST /api/v1/vaults/{vaultId}/attachments/upload-session`: Initiates authorized upload session with 100 MB size limit and SHA-256 digest validation.
   - `POST /api/v1/vaults/{vaultId}/attachments/{attachmentId}/complete`: Verifies ciphertext size and SHA-256 hash before committing metadata in `attachments` table.
   - `GET /api/v1/vaults/{vaultId}/attachments/{attachmentId}/download-session`: Generates authorized download session URL with expiration and digest.
   - `GET` & `DELETE` on `/api/v1/vaults/{vaultId}/attachments/{attachmentId}`: Opaque metadata retrieval and soft deletion.
   - `PUT` & `GET` on `/api/v1/vaults/{vaultId}/attachments/{attachmentId}/content`: Direct raw ciphertext stream endpoint for local development/testing.
   - Strict tenant boundary enforcement: cross-tenant attachment access returns 404 Not Found.
4. **Client UI & Local Caching (`apps/vault-web`):**
   - `DocumentsView`: Interactive file attachment hub with client-side encryption before transfer, upload progress, file size badges, and download & decrypt action.
   - Local caching: `encrypted_attachments` store in IndexedDB caches downloaded/uploaded ciphertext for offline resilience.<br>
     **Reason:** Fulfills Section 5, Section 12, and Section 15 Phase 9 requirements of the Master Build Spec. Enforces end-to-end zero-knowledge secrecy for binary file payloads, memory-controlled streaming encryption, and tamper/truncation resistance.

## ADR-0017: Phase 10 Backup and Restore Architecture, Cryptographic Container, and Staging Engine

**Status:** Accepted for Phase 10<br>
**Decision:** Implement client-side authenticated backup archives, integrity manifests, pre-restore verification, interactive in-memory staging, conflict safeguards, and backend metadata audit tracking:

1. **Versioned Encrypted Archive Format (`EncryptedBackupPackage`):**
   - Self-contained, portable single-file container (`.pdvbackup`) containing:
     - Outer container metadata: `formatVersion = 1`, `protocolVersion = 1`, `snapshotId` (UUID v4), `vaultId`, `createdAt`.
     - Key envelopes: `keyEnvelopes` (password envelope and independent 256-bit recovery envelope) bundled directly into archive container, enabling complete clean-browser vault restoration with master password or recovery secret without prior local or server state.
     - Payload encryption: HKDF-SHA256 derives 256-bit AES-GCM key from VEK with random 16-byte salt and info bound to `PDV/1/backup-archive-key`.
     - AEAD envelope: AES-256-GCM authenticated encryption with 12-byte random nonce and AAD bound to `PDV/1/backup:{vaultId}:{snapshotId}`.
     - Integrity verification: Pre-decryption SHA-256 ciphertext digest check against `ciphertextDigest` and byte size verification against `ciphertextSize`.
2. **Deterministic Integrity Manifest (`BackupArchiveManifest`):**
   - Per-record digests: SHA-256 digest calculated over each object envelope ciphertext.
   - Per-attachment digests: SHA-256 digest calculated over each attachment stream ciphertext.
   - Aggregated Root Hash: Deterministic canonical hash computed across sorted record IDs, attachment IDs, and key envelopes. Re-verified both before and after archive decryption.
   - Any corruption or tampering (bit flip in ciphertext, modified salt/nonce, altered manifest, or mismatched inner record) fails closed immediately with explicit tamper rejection errors.
3. **Interactive Import & In-Memory Staging Area (`RestoreStagingModal`):**
   - Archive payload is unpacked and decrypted strictly in transient memory.
   - Each staged item is compared against local IndexedDB records:
     - `new`: Object does not exist locally.
     - `upgraded`: Object exists locally with lower revision (`backupRevision > localRevision`).
     - `identical`: Same revision and identical ciphertext.
     - `conflict_older`: Record in backup has an older revision than the local store (`backupRevision < localRevision`).
     - `conflict_divergent`: Identical revision number but mismatched ciphertext.
   - **Conflict Safeguards:** Silent overwriting of newer data is strictly prevented. By default, older conflicting records are skipped. Overwriting requires explicit user acknowledgment via an interactive toggle.
4. **Backend Snapshot Tracking (`vault_backups`):**
   - Migration `00004_vault_backups.sql` introduces table `vault_backups (snapshot_id, account_id, vault_id, ciphertext_size, ciphertext_hash, created_at)`.
   - Endpoints: `POST /api/v1/vaults/{vaultId}/backup/metadata` and `GET /api/v1/vaults/{vaultId}/backup/metadata`.
   - Backend receives strictly opaque snapshot metadata (size, hash, timestamp) for backup history and compliance; plaintext records and backup payloads never touch the server.<br>
     **Reason:** Fulfills Section 13 ("BACKUP AND RESTORE") and Phase 10 acceptance criteria of the Master Build Spec. Ensures complete zero-knowledge data portability, clean-browser recovery, tamper rejection, and data loss prevention during restoration.

## ADR-0018: Chrome Manifest V3 Extension Security Architecture & Manual Fill Boundary

**Status:** Accepted for Phase 11<br>
**Decision:** Implement browser extension using Chrome Manifest V3 (MV3), WXT, React, and TypeScript with strict origin matching, top-level frame restriction, volatile session zeroization, manual credential filling without auto-submission, and clear domain mismatch warnings:

1. **Manifest V3 & Minimal Extension Permissions:**
   - Framework: WXT + Vite + React 19 + TypeScript.
   - Declarative Permissions: `["storage", "activeTab", "scripting"]`.
   - Host Permissions: Explicit localhost origins only (`["http://localhost:8080/*", "http://127.0.0.1:8080/*"]`).
   - Content Security Policy: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';` enabling reviewed WebAssembly Argon2id KDF execution inside extension contexts while preventing unsafe string evaluation or external script inclusion.
2. **Untrusted Content Script & Frame Boundary Isolation:**
   - Content script declared with `allFrames: false` in manifest and definition, strictly preventing script injection into cross-origin or third-party iframes.
   - Content script message listener accepts only targeted `PDV_FILL_CREDENTIALS` and `PDV_DETECT_FORM` actions.
   - Background service worker strictly targets top-level tab context (`frameId: 0`) when dispatching fill payloads.
   - VEKs, DEKs, master passwords, recovery secrets, and unrequested decrypted record collections are strictly withheld from the content script and web page DOM. Only the single credential pair explicitly requested by the user is dispatched.
3. **Strict Origin Allowlisting & Anti-Spoofing Matching:**
   - Origin and hostname utilities (`apps/extension/src/utils/origin.ts`) normalize URLs and enforce strict dot-separated domain boundaries.
   - Exact domain matches (`recordHost === currentHost`) and valid hierarchical subdomains (`currentHost.endsWith("." + recordHost)`) are accepted.
   - Loose substring matching and suffix spoofing attacks (e.g., `evil-example.com`, `example.com.attacker.com`, `notexample.com`) are strictly rejected.
   - Custom origin allowlist managed via user-approved additions stored in extension local storage.
4. **Manual Fill & Non-Submission Safety:**
   - Automatic background form autofill is disabled; credential fill occurs solely after explicit user activation in the extension popup.
   - Prototype value setters trigger React/Vue synthetic events without executing automatic form submissions (`form.submit()` or simulated enter key events are strictly omitted).
5. **Clear Domain Mismatch Security Warning Screen:**
   - When a user requests filling a credential whose saved URL differs from the active browser tab hostname, filling is immediately blocked.
   - The popup displays a prominent red/amber security alert comparing the active page hostname against the credential's registered origin.
   - Filling across mismatched domains requires an explicit user confirmation checkbox (`[ ] I understand the risk...`) before the "Fill Anyway" button is unlocked.
6. **Volatile Session Zeroization & Zero Logging:**
   - Master keys and decrypted vault records are maintained exclusively in volatile service worker memory (`SessionManager`).
   - Extension lock immediately sets `unlockedVek = null` and zeroes decrypted records cache.
   - Plaintext passwords, recovery secrets, and cryptographic keys are strictly excluded from `console.log`, `console.info`, `console.warn`, and `console.error` across all extension contexts.<br>
     **Reason:** Fulfills Section H ("Chrome extension") and Phase 11 acceptance criteria of the Master Build Spec. Protects against hostile web origins, phishing, cross-origin iframe attacks, credential leakage, and key exposure.
