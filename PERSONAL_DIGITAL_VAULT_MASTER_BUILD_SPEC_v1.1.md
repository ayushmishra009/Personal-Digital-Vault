# PERSONAL DIGITAL VAULT

## Master Build Specification & AI Coding-Agent Execution Guide

**Document type:** Product Requirements + System Architecture +
Engineering Specification + Implementation Plan\
**Version:** 1.1\
**Status:** Proposed implementation baseline --- security review
required before production use\
**Primary purpose:** Give an AI coding agent (Claude Code, Google
Antigravity, Cursor, Codex, or equivalent) enough context and
constraints to build the complete project end to end.

------------------------------------------------------------------------

# 0. INSTRUCTIONS TO THE AI CODING AGENT

You are the lead product engineer, software architect, security
engineer, and implementation agent for **Personal Digital Vault (PDV)**.

Your task is to build a complete, locally runnable, maintainable
web-based personal digital vault with a Chrome browser extension and a
Go backend. Treat this document as the canonical project specification.

## 0.1 Mandatory working method

1.  **Read this entire document before modifying files.**
2.  Inspect the existing repository before making changes. Preserve
    valid work. Do not blindly overwrite files.
3.  Create and maintain:
    -   `README.md`
    -   `AGENTS.md` (or the equivalent instruction file supported by the
        coding agent)
    -   `docs/IMPLEMENTATION_STATUS.md`
    -   `docs/DECISIONS.md`
    -   `docs/SECURITY_NOTES.md`
    -   `docs/TEST_PLAN.md`
4.  Implement in the phases defined in Section 20. Do not attempt a huge
    unreviewed one-shot implementation.
5.  At the end of every phase:
    -   run formatting, linting, type checks, unit tests and relevant
        integration tests;
    -   fix failures before proceeding;
    -   update implementation status;
    -   list changed files, commands run, results, known gaps and next
        phase.
6.  Keep the application runnable throughout development. Prefer small,
    vertical, working increments.
7.  Do not fabricate successful test results, security properties,
    integrations or completed features.
8.  Do not leave core features as fake buttons, dead links, static mock
    data or TODO-only implementations. If a feature is not implemented,
    mark it clearly as unavailable.
9.  Use realistic seed/demo data only. Never use real personal
    information, real passwords, live credentials or production secrets
    in development fixtures.
10. Ask the user only when a decision is genuinely blocking and cannot
    be resolved from this specification. Otherwise choose a
    conservative, documented default.
11. Do not silently change product requirements or cryptographic
    protocol details. Record proposed changes in `docs/DECISIONS.md` and
    explain their impact.
12. Keep a clear separation between production-ready code, prototypes,
    and security-sensitive code awaiting independent review.

## 0.2 Mandatory CMS-driven and user-configurable architecture

**The entire product must follow a CMS-driven architecture. Do not hardcode user-facing content, configurable application structure, or customer-managed presentation and behavior into source code.** The product is intended to become a standalone, publishable product. Its content and configurable structure must be managed through a separate protected Admin/CMS interface.

### Mandatory principles

1. Provide two distinct experiences sharing the same backend and data source:
   - **Protected Admin/CMS workspace:** authenticated and authorized administrators manage configuration and content through structured forms.
   - **User-facing Vault application:** dynamically renders enabled modules, navigation, screens, sections, forms and presentation from validated configuration and user data.
2. User-facing labels, help text, onboarding copy, empty-state copy, navigation items, section definitions, optional module activation, categories, custom field definitions, form layouts and theme settings must come from CMS-managed records or user settings, not hardcoded component literals.
3. Do not assume a fixed list/order of dashboard cards, sections, navigation items, record categories or optional modules. Fetch configuration and render it dynamically.
4. Every CMS-managed entity must have suitable CRUD operations, validation, authorization, audit history and revision history. Provide form-based add/edit views and table/list views with search, filtering, sorting and pagination where appropriate.
5. Configuration changes must take effect without rebuilding or redeploying the frontend. Implement configuration versioning, refresh and cache invalidation.
6. Use a **sections abstraction**: each section has a stable ID, screen key, trusted section type, display order, enabled/visibility state, validated type-specific configuration payload, constrained style configuration and schema version.
7. Administrators can add, edit, reorder, hide/show and remove optional section instances through the UI. Required security/system functions cannot be removed or disabled in a way that weakens security.
8. Provide safe per-section style controls using approved design tokens and presets. Never allow arbitrary CSS, executable JavaScript or unsafe HTML from CMS fields.
9. Every edit creates an immutable revision. Administrators can inspect history and restore a prior revision; restoring creates a new revision and audit event.
10. Enforce security at the API and data layers, not only by hiding controls in the frontend. Public/unauthenticated reads must be explicitly allowlisted. Administrative reads and all writes require authenticated, authorized sessions.
11. Configuration is account/tenant scoped. One customer's configuration, custom fields, themes, content and navigation must never leak into another customer's instance.
12. Provide first-run owner/admin bootstrap without a universal default password, plus configuration export/import for migration and backup.
13. Default content may be inserted by seeders/migrations, but it must become editable database configuration. It must not be the only possible UI definition embedded in source code.
14. Use declarative, schema-validated configuration rendered by a finite trusted component registry. Never execute code or dynamically import arbitrary components from database payloads.

### Meaning of “nothing hardcoded”

- **Must be data/configuration driven:** user-facing copy, navigation, section composition/order/visibility, optional module activation, categories, custom fields, form layouts, field labels/help text, dashboard widgets, onboarding content and safe theme tokens.
- **Must remain code-enforced:** cryptographic algorithms/protocol invariants, authentication and authorization enforcement, input validation primitives, encryption boundaries, tenant isolation, secure session handling and safe rendering. CMS settings must never override these controls.
- New trusted component types may require a software release; configuring, arranging and styling existing component types must not.

## 0.3 Security rules that override implementation convenience

-   The backend must never receive plaintext vault records,
    master/unlock passwords, recovery secrets, vault encryption keys,
    data-encryption keys, decrypted attachments, or plaintext record
    titles/URLs/categories.
-   Encrypt sensitive data in the client before network transmission or
    persistent server storage.
-   Do not implement custom cryptographic algorithms or invent
    cryptographic primitives.
-   Do not claim "zero knowledge", "end-to-end encrypted", "secure", or
    "production ready" merely because encryption code exists. Verify the
    actual data flows.
-   Do not store secrets in localStorage, sessionStorage, URLs,
    analytics, console logs, crash reports, or ordinary application
    logs.
-   Do not expose keys or unrestricted decrypted vault data to web
    pages, extension content scripts, or third-party scripts.
-   Treat XSS as a potential vault compromise. Use strict CSP, safe
    rendering, dependency hygiene and minimal HTML injection.
-   Never downgrade encryption or disable verification to make tests
    pass.
-   Never silently overwrite a newer record during sync.
-   Never provide an email-based bypass for vault recovery.
-   Do not ship cryptography that has not passed test vectors, negative
    tests and independent review.

## 0.4 If the coding agent has limited context

Work from this file and the repository's `AGENTS.md`. Do not rely on
previous chat history. If the context window is limited, create a
concise continuation note in `docs/IMPLEMENTATION_STATUS.md` and
continue from the last verified phase.

------------------------------------------------------------------------

# 1. PRODUCT OVERVIEW

## 1.1 Product name

**Personal Digital Vault (PDV)**

## 1.2 Product vision

Build a private, cross-device-capable digital vault where a person can
securely organize sensitive information in independently protected
vaults. The product should combine the useful capabilities of a password
manager, secure notes app, identity/document organizer and encrypted
file locker.

The product should be local-first, usable offline after initial setup,
and capable of synchronizing encrypted data through a backend. The
backend coordinates accounts, devices and encrypted data but must not be
able to decrypt vault contents.

## 1.3 Core product principles

1.  **Privacy by architecture:** Sensitive data is encrypted on the
    client.
2.  **Independent vaults:** Each vault has its own encryption boundary
    and unlock secret.
3.  **Local-first:** The user can work with previously synchronized data
    while offline.
4.  **Explicit trust:** A new device must be authorized; account login
    alone does not grant access to vault keys.
5.  **Recoverability with honest limits:** Each vault has a separate
    recovery mechanism. If all valid key material is lost, the data is
    unrecoverable.
6.  **No silent data loss:** Conflicts, deletion and restoration are
    explicit.
7.  **Portable data:** Users can export and restore encrypted backups.
8.  **Progressive delivery:** Deliver a useful, testable foundation
    before adding advanced features.

## 1.4 Target platform and development assumptions

-   Primary application: Web application.
-   Initial browser: Google Chrome.
-   Browser extension: Chrome Manifest V3.
-   Local development and initial hosting: Local machine using Docker
    Compose.
-   Synchronization: Local storage plus cloud/backend synchronization.
-   Profiles/vaults: Independent vaults.
-   Security model: Client-side encryption / zero-knowledge server
    design.
-   Development method: AI-assisted vibecoding.
-   Future clients: Android, iOS, desktop and other browsers are
    possible, but not part of v1.
-   Do not assume the user's existing technology stack must be reused.

------------------------------------------------------------------------

# 2. PRODUCT SCOPE

## 2.1 Core modules

### A. Account and authentication

-   Create account.
-   Sign in and sign out.
-   Passkey/WebAuthn-based authentication where supported.
-   Account session management.
-   View authorized devices.
-   Revoke a device.
-   Account authentication must remain separate from vault unlocking.

### B. Vault management

-   Create a vault.
-   Name and customize a vault.
-   Lock and unlock a vault independently.
-   Change a vault unlock password.
-   Configure or rotate its recovery secret.
-   Lock all vaults.
-   View vault status without revealing contents.
-   Delete a vault with a clear warning and confirmation.
-   Each vault has its own VEK, password envelope, recovery envelope and
    lifecycle.

Suggested initial vaults: - Personal - Professional - Education -
Financial - Custom

These are examples, not hard-coded mandatory categories. Users can
create, rename and delete custom vaults.

### C. Password manager

-   Website/app name.
-   Website URL and one or more associated domains.
-   Username/email.
-   Password.
-   Notes.
-   Tags/folders.
-   Favorite/pinned state.
-   Created and modified timestamps.
-   Password generator.
-   Copy username/password with automatic clipboard clearing where
    browser support allows.
-   Password visibility toggle.
-   Search and filtering.
-   Duplicate detection as a local feature.
-   Password strength estimation performed locally.
-   Optional password history, with explicit retention rules.
-   Never transmit plaintext credentials to the backend.

### D. Secure notes

-   Title.
-   Rich text or safe Markdown/plain-text content.
-   Tags/folders.
-   Favorite state.
-   Search locally after unlock.
-   Encrypted at rest and during sync.

### E. Identity records

-   Name and identity type.
-   Configurable fields.
-   Sensitive identifiers.
-   Expiry date where relevant.
-   Notes and optional attachment.
-   Field-level presentation masking.
-   All values encrypted client-side.

### F. Document and file locker

-   Upload files.
-   Encrypt before upload.
-   Download encrypted files and decrypt locally.
-   Metadata stored in encrypted payload where it could reveal sensitive
    information.
-   File size and type validation.
-   Streaming encryption for large files using a reviewed streaming AEAD
    implementation.
-   File preview only after local decryption and only through a
    controlled, safe rendering path.
-   Never send plaintext documents to the API or object storage.

### G. Payment and financial records

-   Card or account nickname.
-   Cardholder/account name.
-   Number or identifier.
-   Expiry date.
-   Billing notes.
-   Mask sensitive values by default.
-   Do not store CVV/CVC in v1 unless a clear, reviewed requirement
    justifies it. Prefer not to store it.
-   This module is a personal organizer, not a payment processor.

### H. Chrome extension

-   Chrome Manifest V3.
-   Popup for quick access.
-   User must authenticate and unlock the relevant vault independently.
-   Autofill only after explicit user action or a carefully designed
    user-approved flow.
-   Match exact/approved origins; avoid loose substring domain matching.
-   Never send vault keys to content scripts.
-   Content scripts are untrusted and must not receive unrestricted
    vault data.
-   Background/service worker mediates extension operations.
-   Do not inject secrets into arbitrary frames or cross-origin iframes.
-   Provide a clear domain mismatch warning.
-   Do not silently submit forms.
-   Start with manual fill; advanced autofill comes later after security
    review.

### I. Synchronization

-   Upload and download encrypted records.
-   Per-vault operation log.
-   Revision-aware conflict detection.
-   Idempotent retries.
-   Tombstones for deletion.
-   Explicit conflict resolution.
-   Offline queue.
-   No silent last-write-wins for sensitive records.

### J. Backup and restore

-   Generate an encrypted client-side backup.
-   Restore from a backup.
-   Verify integrity before activation.
-   Optional Google Drive backup integration later.
-   OAuth tokens remain client-side.
-   A local web application cannot guarantee background backup while
    closed.
-   Backup copies may remain outside PDV after deletion; disclose this
    to the user.

### K. Device management

-   List devices.
-   Register a new device.
-   Existing authorized device approves a new device.
-   Show device name, browser, created date, last active date and
    status.
-   Revoke device.
-   Device authorization is separate from account authentication and
    vault unlock.
-   Revocation blocks future server access; it cannot erase previously
    downloaded ciphertext or plaintext copied by the device owner.

## 2.2 CMS architecture — mandatory product-wide requirement

The application is a configurable product platform, not a fixed dashboard compiled into the frontend.

### A. Two distinct application surfaces

**Protected Admin/CMS panel**

Accessible only to authenticated users with administrative permission. It manages:
- Modules and navigation.
- Screens/pages and ordered sections.
- Section visibility, content payloads and safe styling.
- Record types, categories and custom field schemas.
- Form layouts and field validation/display rules.
- Theme/design tokens and user-facing copy.
- Onboarding/help content.
- CMS revisions, restore history and audit logs.
- Account, device, vault, security and backup settings.

Each management area should provide structured add/edit forms and a tabular/list view with search, filtering, sorting and pagination where appropriate.

**User-facing Vault application**

Fetches the active account's configuration and dynamically renders enabled modules, navigation, sections, labels, forms and presentation. It must not assume every module is enabled or every section exists. Validate configuration against supported schemas and render only authorized components.

### B. Sections abstraction

A section should include: `id`, `tenant_id`/`owner_id`, `screen_key`, `section_type`, `display_order`, `is_enabled`, validated `visibility`, configurable title/content payload, constrained `style_config`, `schema_version`, timestamps and current revision reference.

Supported trusted section types may include welcome/intro, summary/statistics, recent items, quick actions, vault cards, password list, notes list, document list, custom information panel and help panel. The code implements the safe component types; the administrator controls configured instances, content, order, visibility and supported styling.

### C. Dynamic modules and navigation

Use a data-backed module registry. Each module has a stable key, configurable display name/description, approved icon key, enabled state, route key, permission requirement and order. Administrators can enable/disable optional modules and rearrange navigation. Hiding a module is not authorization: backend routes and APIs must independently enforce access. Core security functions cannot be disabled.

### D. Dynamic record schemas and custom fields

Allow users/admins to create categories and add supported custom fields through the UI. Field types come from a finite safe registry (text, multiline text, URL, email, date, number, boolean, select, multi-select, etc.). Configure label, help text, required status, order, masking and validation constraints. Select options are managed through forms. Private custom field values must be inside the client-side encrypted record payload; do not send plaintext private values or sensitive field labels to the backend. Never allow arbitrary executable code, SQL or unsafe HTML as field behavior.

### E. Theme and styling controls

Provide controls for theme preset, approved colors, typography scale, spacing/density, border radius, card style and section layout. Persist validated design tokens as configuration. Do not accept arbitrary CSS, remote scripts or untrusted HTML.

### F. Version history

For every CMS edit: validate; create an immutable revision; update the current revision pointer transactionally; record actor/time/change summary; publish the new configuration version to clients. Provide history and restore. A restore creates a new revision rather than deleting history.

### G. Security and tenant isolation

Default to private. Explicitly allowlist public content and endpoints. Public visitors may read only content explicitly designated public and safe for publication. All administrative reads and writes require authenticated, authorized sessions. Enforce tenant/account ownership in every database query and API operation. CMS configuration must never grant access to another tenant's records, bypass encryption, unlock a vault or weaken authentication.

### H. Standalone product readiness

Support separate customer/account configuration scopes from the beginning. Provide first-run setup, editable default templates, configuration export/import and versioned schemas/migrations. Software updates must not overwrite customer configuration. Separate code releases from customer content/configuration changes so hosted or self-hosted distribution can be added later.

### I. CMS acceptance criteria

- Admin can change user-facing copy without a code change.
- Admin can add/edit/hide/show/reorder sections and enable/disable optional modules.
- Admin can change navigation labels/order and create supported custom fields/categories.
- Changes appear without rebuild/redeployment.
- Changes are tenant-isolated, versioned and auditable; prior configuration can be restored.
- API tests prove unauthorized users cannot read admin data or perform writes.
- CMS configuration cannot weaken security controls or execute arbitrary code.

## 2.3 Explicitly out of scope for v1

-   Native Android/iOS apps.
-   Native desktop app.
-   Team/family sharing.
-   Enterprise administration.
-   Shared vaults and multi-user collaboration.
-   Payment processing.
-   Browser support beyond Chrome as a release target.
-   AI analysis of vault contents.
-   Server-side plaintext search.
-   Server-side password strength analysis.
-   Automatic form submission.
-   Custom cryptographic primitives.
-   Guaranteed background sync/backup when the local app is closed.
-   Recovery by support staff or email if both vault secrets are lost.

------------------------------------------------------------------------

# 3. USER EXPERIENCE AND INFORMATION ARCHITECTURE

## 3.1 Main navigation

Use a clean, professional, responsive dashboard.

Suggested navigation: - Overview - Vaults - Passwords - Secure Notes -
Identities - Documents - Payments - Devices - Settings

The active vault context must always be visible. If a user is inside a
specific vault, all record operations must be scoped to that vault.

## 3.2 Key screens

1.  Welcome / landing page.
2.  Register.
3.  Sign in.
4.  Account verification or passkey enrollment.
5.  Device approval pending screen.
6.  Dashboard.
7.  Vault selector.
8.  Create vault.
9.  Vault unlock screen.
10. Vault overview.
11. Password list and detail.
12. Password create/edit form.
13. Password generator.
14. Secure notes list and editor.
15. Identity list and editor.
16. Documents list, upload and detail.
17. Payments list and editor.
18. Device management.
19. Backup and restore.
20. Settings.
21. Recovery setup and recovery flow.
22. Conflict resolution screen.
23. Offline/sync status.
24. Empty, loading, error and locked states.

## 3.3 UX requirements

-   Responsive layout for desktop and tablet; mobile web should remain
    usable.
-   Clear locked/unlocked indicators.
-   Never display sensitive content in notification previews.
-   Mask sensitive fields by default.
-   Confirm destructive operations.
-   Make offline state visible.
-   Explain recovery limitations before the user relies on recovery.
-   Use accessible labels, keyboard navigation, focus states and
    sufficient contrast.
-   Use loading, success, empty and error states consistently.
-   Do not display fake security badges or unsupported claims.

------------------------------------------------------------------------

# 4. FINAL TECHNOLOGY STACK

Use these versions as compatibility targets, but select mutually
compatible current stable releases at implementation time. Pin versions
in lockfiles and document material upgrades.

## 4.1 Frontend

-   React
-   TypeScript
-   Vite
-   Tailwind CSS
-   shadcn/ui (Radix-based components)
-   React Router
-   TanStack Query for server state
-   Zustand or a similarly small state store for transient UI state only
-   React Hook Form
-   Zod for validation
-   IndexedDB through a maintained wrapper such as Dexie

## 4.2 Browser extension

-   WXT
-   React
-   TypeScript
-   Chrome Manifest V3

## 4.3 Backend

-   Go
-   Modular monolith architecture
-   REST API
-   OpenAPI 3.1 contract
-   PostgreSQL
-   Structured logging
-   Database migrations
-   Request validation and centralized error handling

## 4.4 Cryptographic core

-   TypeScript package shared by web app and extension.
-   Web Crypto API for standard browser cryptographic operations.
-   Reviewed, maintained Argon2id WASM implementation for password-based
    key derivation.
-   AES-256-GCM for encrypted record payloads.
-   HKDF-SHA-256 for domain-separated key derivation.
-   AES-KW for key wrapping where appropriate.
-   For large files, use a reviewed streaming AEAD implementation such
    as libsodium `crypto_secretstream_xchacha20poly1305` through a
    maintained binding, after evaluating maintenance, browser
    compatibility, test vectors and security posture.
-   Do not implement a custom streaming cipher.

## 4.5 Infrastructure and tooling

-   pnpm workspaces.
-   Turborepo.
-   Docker Compose.
-   PostgreSQL.
-   MinIO for local S3-compatible encrypted object storage.
-   Redis is optional and must not be added without a concrete
    requirement.
-   GitHub Actions for CI.
-   OpenAPI-generated or contract-validated API types where practical.
-   Playwright for end-to-end browser tests.
-   Vitest for frontend/package tests.
-   Go testing and race detector for backend.

## 4.6 Repository layout

Use a monorepo:

``` text
personal-digital-vault/
├── apps/
│   ├── web/                    # React web app
│   ├── extension/              # WXT Chrome extension
│   └── api/                    # Go backend (own go.mod)
├── packages/
│   ├── crypto-core/            # Cryptographic protocol implementation
│   ├── vault-engine/           # Vault lifecycle and encrypted record operations
│   ├── sync-engine/            # Local queue, sync and conflict handling
│   ├── data-models/            # Shared domain types
│   ├── validation/             # Zod schemas and validation
│   ├── api-client/             # Typed API client
│   └── ui-components/          # Shared UI components if useful
├── contracts/
│   └── openapi.yaml
├── database/
│   └── migrations/
├── infrastructure/
│   ├── docker/
│   └── scripts/
├── docs/
│   ├── IMPLEMENTATION_STATUS.md
│   ├── DECISIONS.md
│   ├── SECURITY_NOTES.md
│   ├── TEST_PLAN.md
│   └── architecture/
├── .github/workflows/
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── .env.example
├── .gitignore
├── AGENTS.md
└── README.md
```

Keep the Go module self-contained in `apps/api`. Do not force Go into
the JavaScript workspace.

------------------------------------------------------------------------

# 5. ARCHITECTURAL OVERVIEW

## 5.1 High-level architecture

``` text
                  CHROME BROWSER
┌──────────────────────────────────────────────────────┐
│                                                      │
│  React Web App                 Chrome Extension      │
│  ┌─────────────────────┐      ┌───────────────────┐  │
│  │ UI / Forms / Views  │      │ Popup / Options   │  │
│  └──────────┬──────────┘      └─────────┬─────────┘  │
│             │                           │            │
│  ┌──────────▼──────────┐      ┌─────────▼─────────┐  │
│  │ Vault Engine        │      │ Extension Service │  │
│  └──────────┬──────────┘      │ Worker            │  │
│             │                 └─────────┬─────────┘  │
│  ┌──────────▼───────────────────────────▼─────────┐  │
│  │ TypeScript Crypto Core                         │  │
│  │ KDF / Key hierarchy / AEAD / envelopes         │  │
│  └──────────────────────┬─────────────────────────┘  │
│                         │                            │
│  ┌─────────────────────▼──────────────────────────┐  │
│  │ IndexedDB                                      │  │
│  │ Encrypted records / local operation queue      │  │
│  └─────────────────────┬──────────────────────────┘  │
└────────────────────────┼─────────────────────────────┘
                         │ HTTPS: ciphertext + metadata
                         ▼
              ┌─────────────────────┐
              │ Go API              │
              │ Auth / Devices      │
              │ Vault metadata      │
              │ Sync / Backup       │
              └──────────┬──────────┘
                         │
             ┌───────────┴────────────┐
             ▼                        ▼
       PostgreSQL               MinIO / S3
       Account metadata         Encrypted blobs
       Device metadata          Ciphertext only
       Sync events
```

## 5.2 CMS/configuration architecture

Implement a configuration service shared by the Admin/CMS panel and the user-facing vault application. Recommended backend domains include `cms_modules`, `cms_navigation_items`, `cms_screens`, `cms_sections`, `cms_record_types`, `cms_field_definitions`, `cms_theme_settings`, `cms_content_entries`, `cms_revisions` and `cms_audit_events`. All records are account/tenant scoped. Use versioned JSON schemas for flexible section payloads while keeping ownership, permissions and critical relationships relational and constrained.

Suggested API groups (final schemas belong in OpenAPI):
- `/api/v1/admin/cms/modules`
- `/api/v1/admin/cms/navigation`
- `/api/v1/admin/cms/screens`
- `/api/v1/admin/cms/sections`
- `/api/v1/admin/cms/record-types`
- `/api/v1/admin/cms/fields`
- `/api/v1/admin/cms/themes`
- `/api/v1/admin/cms/revisions`
- `/api/v1/app/configuration`

The app configuration endpoint returns only configuration the authenticated account is allowed to receive. The renderer fetches configuration, validates its version/schema, resolves section types through a finite trusted component registry, renders enabled sections in configured order, applies allowlisted style tokens, safely skips unknown types, and refreshes when the configuration version changes. Clear account-scoped cached configuration on logout/account switch. Never execute database payloads or dynamically import arbitrary component names.

## 5.3 Trust boundaries

-   Browser UI is trusted only to the extent that the origin and runtime
    are uncompromised.
-   Browser extensions have a separate trust boundary.
-   Content scripts and pages visited by the user are untrusted.
-   Backend is trusted to enforce authorization and preserve ciphertext,
    but is not trusted with plaintext vault data or keys.
-   PostgreSQL and object storage contain sensitive ciphertext and
    minimal metadata.
-   A compromised browser, malicious extension, XSS, malware or
    compromised endpoint may expose data while a vault is unlocked. This
    limitation must be documented.

## 5.4 Data classification

**Server may store:** - Account ID and authentication-related
metadata. - Device public keys and device metadata. - Vault opaque IDs
and non-sensitive operational metadata. - Salt and KDF parameters
required to derive keys (not the password). - Wrapped VEK envelopes. -
Encrypted record payloads. - Encrypted file blobs. - Ciphertext hashes,
revision numbers and sync sequence numbers. - Minimal audit/security
events.

**Server must not store:** - Vault unlock password. - Recovery secret. -
Plaintext VEK or DEK. - Plaintext password records. - Plaintext secure
notes. - Plaintext identity/payment/document fields. - Decrypted
attachments. - Plaintext record titles, URLs, tags or categories if they
reveal private information. - Plaintext search indexes.

Prefer opaque IDs and generic object types where metadata leakage
matters. Explain unavoidable metadata leakage in the threat model.

------------------------------------------------------------------------

# 6. VAULT AND KEY ARCHITECTURE

This section is security-critical. Implement only after a written
protocol review, test vectors and negative tests.

## 6.1 Independent vault model

Each vault has: - Random opaque `vault_id`. - Independent random 256-bit
Vault Encryption Key (VEK). - Independent unlock password. - Independent
salt and KDF parameters. - Password-derived key envelope wrapping the
VEK. - Independent random recovery secret. - Recovery-derived key
envelope wrapping the VEK. - Independent lock/unlock state in the
client.

Unlocking one vault must not unlock another.

## 6.2 Key hierarchy

Conceptual hierarchy:

``` text
User's vault unlock password
          │
          ▼
      Argon2id
          │
          ▼
  Password-derived key material
          │
          ▼
 HKDF-SHA-256 (domain-separated context)
          │
          ▼
  Password wrapping key
          │
          ▼
     unwrap VEK
          │
          ▼
      Vault VEK
          │
          ▼
 HKDF-SHA-256 (vault/object/revision context)
          │
          ▼
  DEK wrapping key
          │
          ▼
     unwrap DEK
          │
          ▼
  Record DEK (fresh per revision)
          │
          ▼
     AES-256-GCM
          │
          ▼
  Encrypted record payload
```

Recovery secret follows a separate derivation path and wraps the same
VEK independently.

## 6.3 Password-based key derivation

-   Use Argon2id from a reviewed maintained implementation.
-   Generate a cryptographically random salt per vault password
    envelope.
-   Store salt, KDF algorithm identifier, version and parameters with
    the envelope.
-   Parameters must be calibrated on target devices and reviewed for
    denial-of-service risks.
-   Never hard-code parameters without benchmarking and documenting
    them.
-   Never use a fast hash such as SHA-256 alone as a password KDF.
-   Avoid logging password input or derived material.
-   Password changes should rewrap the VEK, not decrypt/re-encrypt every
    record, unless a protocol migration requires it.

## 6.4 VEK and DEK

-   Generate VEK using a cryptographically secure random number
    generator.
-   Generate a fresh DEK for each record revision.
-   Encrypt record payload with AES-256-GCM.
-   Use a fresh 96-bit nonce for every encryption under a given AES-GCM
    key.
-   Store nonce and ciphertext together in a versioned envelope.
-   Authenticate canonical metadata as AAD, including protocol version,
    vault ID, opaque object ID, revision, payload format version and
    purpose.
-   Never reuse a nonce with the same AES-GCM key.
-   Do not derive record nonces from timestamps or counters unless a
    separately reviewed protocol explicitly requires it.

## 6.5 Key wrapping and domain separation

AES-KW does not support AAD. To bind wrapped keys to their intended
context: - Derive a distinct wrapping key with HKDF-SHA-256 and
canonical, domain-separated context. - Context must include protocol
version, vault ID, purpose and, for object DEKs, object ID and
revision. - Then wrap the VEK or DEK using AES-KW. - Specify canonical
byte encoding, field ordering, length-prefixing and salt policy in a
dedicated protocol document and test vectors. - Do not improvise string
concatenation for cryptographic context. - Reject envelopes whose
context/version does not match the expected object.

This proposal requires cryptographic review before production.

## 6.6 Recovery

Each vault has a separate high-entropy recovery secret.

Recovery flow: 1. User authenticates to the account. 2. Client retrieves
that vault's recovery envelope and public KDF/context metadata. 3. User
enters recovery secret locally. 4. Client derives recovery wrapping key
and unwraps VEK locally. 5. Client validates a known integrity check or
successfully decrypts an authenticated object. 6. User sets a new unlock
password. 7. Client creates a new password envelope. 8. Optionally
rotate recovery secret and recovery envelope. 9. Old envelope
invalidation and device synchronization follow a documented process.

Rules: - Email must never bypass vault encryption. - Support staff
cannot recover a lost VEK. - If both password and recovery secret are
lost and no valid unlocked device/backup can recover the VEK, the vault
is unrecoverable. - Explain this clearly during setup. - Recovery secret
generation, encoding, transcription checks and storage guidance require
careful UX and security review.

## 6.7 Locking and key lifecycle

-   Keep keys in memory only while needed.
-   Avoid persistent browser storage of plaintext keys.
-   Clear transient key references on lock, logout and device revocation
    where possible.
-   Implement inactivity timeout and manual lock.
-   Consider browser page visibility and device sleep behavior.
-   JavaScript memory cannot guarantee secure zeroization; document this
    limitation.
-   Do not promise that garbage collection instantly erases secrets.
-   Lock all vaults on logout by default.
-   A vault lock must stop new decrypt operations and clear decrypted UI
    state.

------------------------------------------------------------------------

# 7. ENCRYPTED DATA FORMAT AND DOMAIN MODELS

## 7.1 Versioned encrypted envelope

Define a versioned envelope. Example conceptual structure:

``` json
{
  "protocolVersion": 1,
  "algorithm": "AES-256-GCM",
  "keyWrapAlgorithm": "AES-KW",
  "vaultId": "opaque-id",
  "objectId": "opaque-id",
  "revision": 3,
  "payloadVersion": 1,
  "purpose": "vault-record",
  "nonce": "base64url",
  "wrappedDek": "base64url",
  "ciphertext": "base64url"
}
```

This is an illustrative shape, not a final wire format. Define exact
schemas, canonical encoding and validation before implementing crypto.

## 7.2 Record payloads

The encrypted plaintext payload may contain: - Record type. - Title. -
Fields. - Tags. - Notes. - User-defined metadata. - Created/updated
timestamps. - Attachment references. - Schema version.

Keep sensitive metadata inside ciphertext. Only expose the minimum
server fields needed for synchronization.

## 7.3 Shared types

Define strict TypeScript types for: - Account session state. - Device. -
Vault metadata. - Vault key envelope. - Encrypted object envelope. -
Decrypted record union. - Password record. - Secure note. - Identity
record. - Document metadata. - Payment record. - Sync operation. - Sync
cursor. - Conflict. - Backup manifest.

Use discriminated unions for record types. Validate all untrusted data
at runtime with Zod or equivalent.

------------------------------------------------------------------------

# 8. LOCAL STORAGE AND OFFLINE-FIRST DESIGN

## 8.1 IndexedDB

Use IndexedDB for: - Encrypted record envelopes. - Encrypted attachment
chunks or blobs where feasible. - Local operation queue. - Sync
cursor. - Non-secret vault metadata. - Local device/session metadata as
appropriate.

Never persist plaintext vault records or raw keys in ordinary IndexedDB
tables. If decrypted caching is introduced, it must be memory-only by
default and separately reviewed.

## 8.2 Local database design

Suggested stores: - `vault_metadata` - `encrypted_records` -
`encrypted_attachments` - `pending_operations` - `sync_state` -
`device_metadata` - `schema_migrations`

Define indexes by opaque vault ID, object ID, revision, operation ID and
status. Do not create plaintext indexes over private fields.

## 8.3 Offline behavior

-   A previously authorized device may unlock a vault offline if it has
    the required encrypted envelope and locally stored ciphertext.
-   The user must understand that offline access does not imply the
    latest server state.
-   Local edits become queued operations.
-   On reconnect, sync engine uploads operations in order and resolves
    revision conflicts.
-   Display pending, synced, conflict and failed states.
-   Do not delete local data merely because a server request failed.
-   Handle browser storage quota and eviction risks. Explain that
    browser storage is not an immutable backup.

------------------------------------------------------------------------

# 9. BACKEND DESIGN

## 9.1 Go modular monolith

Suggested modules: - `auth` - `accounts` - `devices` - `vaults` -
`sync` - `attachments` - `backup` - `audit` - `health` - `config` -
`database` - `middleware`

Use clear package boundaries and dependency injection. Avoid premature
microservices.

## 9.2 Backend responsibilities

-   Account authentication and session management.
-   Device enrollment and authorization.
-   Authorization checks.
-   Store minimal vault metadata and encrypted envelopes.
-   Accept and distribute encrypted records.
-   Maintain revision and sync sequence.
-   Issue scoped, short-lived object-storage upload/download
    authorization.
-   Enforce request size limits, rate limits and quotas.
-   Validate schemas and ownership.
-   Provide health/readiness endpoints.
-   Produce privacy-conscious security audit events.

The backend must not decrypt user data.

## 9.3 API principles

-   REST API under `/api/v1`.
-   JSON for ordinary requests; multipart or presigned object-storage
    flow for encrypted attachments.
-   Consistent error envelope.
-   Request IDs.
-   Pagination/cursors.
-   Idempotency keys for mutations.
-   Optimistic concurrency.
-   Rate limiting for authentication, enrollment and recovery-related
    endpoints.
-   Strict CORS and CSRF strategy appropriate to the selected
    authentication/session design.
-   TLS in deployed environments.
-   Local HTTP may be used only for local development.

## 9.4 Suggested endpoints

### Health

-   `GET /health/live`
-   `GET /health/ready`

### Account/auth

-   `POST /api/v1/auth/register`
-   `POST /api/v1/auth/login`
-   `POST /api/v1/auth/logout`
-   `GET /api/v1/auth/session`
-   Passkey registration/authentication endpoints as specified by the
    selected WebAuthn library and protocol.

### Devices

-   `GET /api/v1/devices`
-   `POST /api/v1/devices/enrollment`
-   `GET /api/v1/devices/enrollment/{id}`
-   `POST /api/v1/devices/enrollment/{id}/approve`
-   `POST /api/v1/devices/{id}/revoke`

### Vaults

-   `GET /api/v1/vaults`
-   `POST /api/v1/vaults`
-   `GET /api/v1/vaults/{vaultId}`
-   `PUT /api/v1/vaults/{vaultId}/envelopes/password`
-   `PUT /api/v1/vaults/{vaultId}/envelopes/recovery`
-   `DELETE /api/v1/vaults/{vaultId}`

Vault endpoints transport opaque metadata and encrypted envelopes only.
Validate that no plaintext fields are accepted.

### Sync

-   `GET /api/v1/vaults/{vaultId}/sync?after={cursor}`
-   `POST /api/v1/vaults/{vaultId}/sync/operations`
-   `GET /api/v1/vaults/{vaultId}/objects/{objectId}`
-   `PUT /api/v1/vaults/{vaultId}/objects/{objectId}`

### Attachments

-   `POST /api/v1/vaults/{vaultId}/attachments/upload-session`
-   `POST /api/v1/vaults/{vaultId}/attachments/{attachmentId}/complete`
-   `GET /api/v1/vaults/{vaultId}/attachments/{attachmentId}/download-session`
-   `DELETE /api/v1/vaults/{vaultId}/attachments/{attachmentId}`

### Backup

-   `POST /api/v1/vaults/{vaultId}/backup/metadata`
-   `GET /api/v1/vaults/{vaultId}/backup/metadata`

Backup file content should be generated and encrypted client-side.
Server backup metadata must not expose secrets.

These endpoints are a starting contract. Final schemas and semantics
must be defined in `contracts/openapi.yaml` before implementation.

## 9.5 Database schema

Use PostgreSQL migrations. Suggested tables:

### `accounts`

-   `id`
-   `email_normalized`
-   `created_at`
-   `updated_at`
-   account status fields

### `auth_credentials`

-   `id`
-   `account_id`
-   credential type
-   WebAuthn credential/public key metadata or external auth subject
-   created/last-used timestamps

Do not store plaintext passwords. If password authentication is
implemented, use a reviewed server-side password hashing scheme and rate
limiting. Prefer passkeys where feasible.

### `devices`

-   `id`
-   `account_id`
-   device public key
-   device label
-   platform/browser metadata
-   status
-   created_at
-   last_seen_at
-   revoked_at

### `device_enrollments`

-   `id`
-   `account_id`
-   new device public key
-   challenge hash
-   expiry
-   status
-   approval metadata

### `vaults`

-   `id`
-   `account_id`
-   opaque label only if user accepts metadata leakage; otherwise
    encrypted label
-   protocol version
-   status
-   created_at
-   updated_at

### `vault_key_envelopes`

-   `id`
-   `vault_id`
-   envelope type (`password` or `recovery`)
-   encrypted envelope bytes
-   KDF algorithm/parameters/salt metadata
-   protocol version
-   created_at
-   updated_at

### `vault_objects`

-   `id`
-   `vault_id`
-   current revision
-   encrypted envelope bytes or object reference
-   ciphertext hash
-   created_at
-   updated_at
-   deleted_at/tombstone marker

### `sync_events`

-   `sequence_id`
-   `vault_id`
-   `operation_id`
-   `object_id`
-   base revision
-   new revision
-   encrypted operation payload
-   created_at

### `attachments`

-   `id`
-   `vault_id`
-   opaque object-storage key
-   ciphertext size
-   ciphertext hash
-   created_at
-   deleted_at

### `idempotency_records`

-   account/device scope
-   idempotency key
-   request digest
-   response reference
-   created_at
-   expiry

### `audit_events`

-   account/device IDs
-   event type
-   timestamp
-   non-sensitive details only

Add foreign keys, unique constraints, indexes and retention policies. Do
not place plaintext vault content in database columns.

------------------------------------------------------------------------

# 10. DEVICE ENROLLMENT AND AUTHORIZATION

## 10.1 Required flow

1.  New device authenticates to the account.
2.  Backend marks it as pending.
3.  New device displays a short-lived pairing code or QR reference.
4.  Existing authorized device retrieves enrollment details.
5.  Existing device displays device name, browser/platform, approximate
    context and expiry.
6.  User explicitly approves or rejects.
7.  Approval is cryptographically bound to the challenge, account, new
    device public key, nonce and expiry.
8.  Backend verifies approval and activates device.
9.  New device receives access to ciphertext only for explicitly granted
    vaults.
10. User unlocks each vault separately with that vault's unlock secret.

## 10.2 Security requirements

-   Pairing codes are short-lived, single-use and rate-limited.
-   Prevent replay.
-   Bind approval to the new device's public key.
-   Device fingerprinting is not cryptographic identity.
-   Device private keys must be protected using browser-supported secure
    storage where possible; evaluate Web Crypto non-extractable keys and
    their limitations.
-   The exact key algorithm, signature format and private-key
    persistence design are unresolved security decisions. Do not invent
    these silently.
-   Revocation blocks future server access but cannot erase downloaded
    ciphertext or copied plaintext.

------------------------------------------------------------------------

# 11. SYNCHRONIZATION AND CONFLICT RESOLUTION

## 11.1 Model

Use a per-vault append-only operation log with: - Monotonically
increasing server sequence. - Per-object revision. - Unique operation
ID. - Base revision. - New revision. - Encrypted operation payload. -
Device ID. - Client timestamp as informational only.

## 11.2 Upload algorithm

For each operation: 1. Authenticate device and account. 2. Verify vault
access. 3. Check idempotency key and operation ID. 4. If same ID and
same request digest already exists, return previous result. 5. If same
ID with different digest, reject. 6. Check object's current revision
against base revision. 7. If mismatch, return conflict (HTTP 409) with
enough opaque revision metadata for the client to fetch latest
ciphertext. 8. If valid, store ciphertext, append event and allocate
server sequence transactionally. 9. Return accepted revision and cursor.

## 11.3 Conflict behavior

-   Never silently overwrite a newer revision.
-   Client downloads latest encrypted revision.
-   Client decrypts locally.
-   User sees both versions in a safe comparison UI.
-   User chooses which to keep or manually merges.
-   Resolution is a new revision based on the current server revision.
-   For passwords, identity records and secure notes, do not use
    automatic field merge in v1 unless each field has a separately
    reviewed merge policy.
-   CRDTs are deferred.

## 11.4 Deletion

-   Use tombstones.
-   Deletion is a sync operation.
-   Tombstones must remain long enough to prevent deleted records from
    reappearing on stale devices.
-   Define retention and permanent purge separately.
-   Explain that backups may retain older copies.

## 11.5 Reliability

Test: - Duplicate retries. - Same ID/different body. - Concurrent
updates. - Out-of-order requests. - Network loss after server commit. -
Client crash during upload. - Cursor pagination. - Tombstone
propagation. - Attachment retry. - Corrupt event rejection.

------------------------------------------------------------------------

# 12. CHROME EXTENSION SECURITY AND FUNCTIONALITY

## 12.1 Architecture

-   WXT + React + TypeScript.
-   Manifest V3.
-   Popup UI.
-   Background service worker.
-   Content script with minimal privileges.
-   Options/settings page if needed.

## 12.2 Rules

-   Content script is untrusted.
-   Do not place VEK, DEK or unrestricted decrypted record collections
    in page context or content script.
-   Content script may identify a form and request a fill operation
    through a narrow message protocol.
-   Background/service worker validates origin and user approval.
-   Keep permissions minimal; request optional host permissions where
    possible.
-   Avoid `<all_urls>` unless absolutely necessary and justified.
-   Use exact normalized origin matching and explicit user-managed
    domain associations.
-   Protect against frame confusion, hostile pages, spoofed messages and
    replay.
-   Do not log credentials.
-   Do not silently fill or submit.
-   Provide a manual fill experience first.
-   Extension must lock independently or follow a clearly documented
    shared session model; do not assume a web app session automatically
    makes extension access safe.

## 12.3 Initial extension milestone

-   Installable unpacked extension.
-   Popup opens.
-   Shows locked/unlocked state.
-   Connects to local API.
-   Can list opaque vault names only if labels are intentionally
    non-sensitive, otherwise decrypt labels locally.
-   Manual password lookup and fill through a narrow background-mediated
    flow.
-   Domain mismatch warnings.
-   No automatic submission.

------------------------------------------------------------------------

# 13. BACKUP AND RESTORE

## 13.1 Backup archive

Generated entirely on the client. Include: - Format and protocol
version. - Opaque vault ID. - Wrapped key envelopes. - Encrypted record
objects. - Encrypted attachments. - Revisions and sync cursor. -
Integrity manifest. - Snapshot ID and creation timestamp.

Do not include plaintext unlock password, recovery secret, VEK or DEKs.

## 13.2 Backup process

1.  User chooses vault and backup destination.
2.  Client retrieves local/server ciphertext and encrypted attachments.
3.  Client creates a versioned archive.
4.  Client verifies archive structure and integrity.
5.  User downloads or sends it to a configured provider.
6.  Optional provider upload uses client-side OAuth flow and client-held
    token.
7.  Backend never sees the OAuth refresh token for the user's personal
    Drive account.

## 13.3 Restore process

1.  User selects backup.
2.  Client validates archive format and size limits.
3.  Client verifies integrity manifest.
4.  User authenticates and provides relevant vault unlock/recovery
    secret.
5.  Client decrypts in a staging area.
6.  User reviews vault identity and restore target.
7.  User confirms activation.
8.  Client reconciles revisions carefully; never overwrite newer
    local/server state without explicit confirmation.

## 13.4 Google Drive

Optional later integration: - Google OAuth initiated by client. -
Request minimum required scopes. - Keep tokens in client-side secure
session storage where feasible. - Upload only encrypted backup
archive. - Explain local app must be running for scheduled local backup
unless a separately designed cloud service is introduced.

------------------------------------------------------------------------

# 14. AUTHENTICATION, SESSIONS AND APPLICATION SECURITY

## 14.1 Separate three concepts

1.  **Account authentication:** proves control of account.
2.  **Device authorization:** proves device is approved for
    account/vault access.
3.  **Vault unlocking:** locally unwraps a specific vault's VEK.

Do not collapse these into one password or session.

## 14.2 Session requirements

-   Use secure, HttpOnly, SameSite cookies where architecture supports
    them.
-   Define CSRF protections.
-   Use short-lived access/session lifetimes and rotation appropriate to
    the auth method.
-   Revoke sessions on logout and device revocation.
-   Do not store bearer tokens in localStorage.
-   Avoid exposing tokens to extension content scripts.
-   Rate-limit login and enrollment.
-   Use secure password hashing only if account password login is
    implemented.
-   Prefer passkeys/WebAuthn where feasible, with a carefully designed
    fallback.

## 14.3 Web security

-   Strict Content Security Policy.
-   Avoid unsafe-inline and unsafe-eval.
-   No arbitrary HTML rendering of decrypted notes.
-   Sanitize Markdown with a maintained sanitizer and safe
    configuration.
-   Validate all input at client and server.
-   Protect against CSRF, XSS, SSRF, IDOR, path traversal, request
    smuggling and insecure direct object references.
-   CORS allowlist, not wildcard credentials.
-   Secure headers.
-   Dependency scanning and lockfile review.
-   No secrets in logs.
-   No production debug endpoints.

------------------------------------------------------------------------

# 15. API CONTRACT AND ERROR MODEL

Define OpenAPI 3.1 before or alongside backend implementation.

## 15.1 Standard error envelope

Conceptual example:

``` json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "The object has changed on another device.",
    "requestId": "opaque-request-id",
    "details": {
      "currentRevision": 7
    }
  }
}
```

Do not include plaintext private content in error details.

## 15.2 Expected status codes

-   `200` successful read/update.
-   `201` created.
-   `202` accepted for asynchronous upload/session operation.
-   `204` successful no-content operation.
-   `400` malformed request.
-   `401` unauthenticated.
-   `403` authenticated but unauthorized.
-   `404` not found or intentionally concealed.
-   `409` revision conflict or state conflict.
-   `413` payload too large.
-   `422` schema/semantic validation failure.
-   `429` rate limit.
-   `500` generic internal error without sensitive details.

------------------------------------------------------------------------

# 16. OBSERVABILITY, LOGGING AND AUDIT

-   Structured logs.
-   Request correlation ID.
-   Health and readiness endpoints.
-   Metrics for latency, errors, sync backlog and storage use.
-   Audit events for account/device/security actions.
-   Never log plaintext records, secrets, key material, full encrypted
    payloads or sensitive URLs.
-   Do not include decrypted content in telemetry.
-   Make analytics opt-in if introduced; default to no vault-content
    analytics.
-   Provide a local development log level that remains privacy-safe.

------------------------------------------------------------------------

# 17. TESTING STRATEGY

## 17.1 Crypto-core tests

Mandatory: - Known-answer test vectors for each primitive. - Argon2id
parameter and output tests. - HKDF test vectors. - AES-GCM
encrypt/decrypt. - Wrong key rejection. - Modified nonce/ciphertext/AAD
rejection. - AES-KW wrap/unwrap. - Wrong context rejection. -
Cross-vault key isolation. - Cross-object and cross-revision context
isolation. - Nonce uniqueness tests at the protocol layer. - Malformed
envelope rejection. - Protocol version rejection/migration. - Recovery
envelope tests. - Streaming AEAD chunk ordering, truncation and
tampering tests. - Fuzz malformed inputs where practical.

Do not write tests that merely verify that encrypt/decrypt round-trips.
Round-trip tests alone are insufficient.

## 17.2 Frontend tests

-   Vault creation and unlock.
-   Independent vault locking.
-   Record create/read/update/delete.
-   Masked fields.
-   Password generator.
-   Clipboard clearing behavior.
-   Offline operation queue.
-   Conflict resolution.
-   Backup and restore UI.
-   Accessibility checks.

## 17.3 Backend tests

-   Auth and authorization.
-   Account/device isolation.
-   Vault ownership.
-   Device enrollment approval/replay/expiry.
-   Revoked device rejection.
-   Idempotency.
-   Concurrent revision conflicts.
-   Cursor pagination.
-   Tombstones.
-   Attachment authorization and size limits.
-   No plaintext private data accepted in forbidden fields.
-   Rate limiting.
-   SQL transaction integrity.

## 17.4 End-to-end tests

Use Playwright: - Register and sign in. - Enroll/approve a second test
device. - Create two independent vaults. - Unlock one without unlocking
the other. - Create encrypted password and note. - Verify API/database
only contain ciphertext and permitted metadata. - Go offline,
create/edit, reconnect and sync. - Create concurrent edits and resolve
conflict. - Backup, delete local data, restore. - Revoke a device and
verify future API access fails. - Extension manual fill on an approved
test origin. - Test locked state and idle lock.

## 17.5 CMS architecture acceptance tests

- Verify configurable navigation, dashboard sections, labels and optional modules are sourced from CMS/configuration APIs, not hardcoded UI arrays/literals.
- Verify seed configuration is editable database data.
- Verify admin CRUD, section order/visibility and module activation.
- Verify updates appear without rebuild/redeployment.
- Verify account/tenant isolation for every CMS entity.
- Verify unauthenticated/non-admin API requests are rejected.
- Verify unsafe or unknown configuration payloads are rejected or safely ignored.
- Verify revision creation, history and restore.
- Verify arbitrary HTML, CSS, JavaScript, SQL and dynamic imports cannot be supplied through CMS fields.

## 17.6 Security acceptance tests

Create explicit tests proving: - Backend cannot decrypt records using
server-held information. - No plaintext secret appears in API requests,
logs or database. - Vault A key cannot decrypt Vault B objects. - A
password envelope from one vault cannot unwrap another vault's VEK. -
Recovery envelope is independent from password envelope. - Modified
ciphertext is rejected. - Revoked device cannot fetch new ciphertext. -
XSS test payloads do not execute in notes. - Hostile page cannot access
extension key material.

Passing these tests is necessary but not sufficient for security
certification.

------------------------------------------------------------------------

# 18. DEVELOPMENT ENVIRONMENT AND LOCAL SETUP

## 18.1 Prerequisites

-   Git.
-   Node.js current LTS.
-   pnpm.
-   Go current stable release.
-   Docker Desktop or Docker Engine + Compose.
-   Chrome.
-   A code editor/AI coding agent.

Document exact tested versions in README.

## 18.2 Local services

Docker Compose should provide: - PostgreSQL. - MinIO. - Optional MinIO
console for development only.

Do not expose development admin consoles in production.

## 18.3 Environment variables

Create `.env.example` with safe placeholders: - `APP_ENV` - `API_PORT` -
`DATABASE_URL` - `SESSION_SECRET` (local-only placeholder) -
`MINIO_ENDPOINT` - `MINIO_ACCESS_KEY` - `MINIO_SECRET_KEY` -
`MINIO_BUCKET` - `WEB_ORIGIN` - `API_ORIGIN` - `LOG_LEVEL`

Never commit actual `.env` or secrets. Validate required environment at
startup. Use separate development/test configurations.

## 18.4 Developer commands

Provide consistent root commands, for example: - `pnpm install` -
`pnpm dev` - `pnpm build` - `pnpm lint` - `pnpm typecheck` -
`pnpm test` - `pnpm test:e2e` - `pnpm format` - `pnpm db:migrate` -
`pnpm db:seed` - `pnpm docker:up` - `pnpm docker:down`

Go-specific commands may be exposed through scripts but should remain
native Go commands internally.

------------------------------------------------------------------------

# 19. QUALITY, DESIGN AND CODE STANDARDS

## 19.1 General engineering

-   TypeScript strict mode.
-   Avoid `any`; justify exceptional use.
-   Go idiomatic style, explicit errors and context propagation.
-   Small modules and clear interfaces.
-   No circular dependencies.
-   No duplicated cryptographic logic.
-   Validate at trust boundaries.
-   Use migrations, not ad hoc schema changes.
-   Keep API contract and implementation synchronized.
-   Add tests with every meaningful feature.
-   Use dependency versions pinned by lockfiles.
-   Avoid unnecessary libraries.

## 19.2 UI design

-   Professional, minimal, calm visual language.
-   Prioritize clarity and trust over decorative security imagery.
-   Use a consistent spacing and typography system.
-   Responsive dashboard.
-   Clear vault context and lock state.
-   Sensitive values masked by default.
-   Keyboard accessible.
-   Avoid clutter and unnecessary animation.
-   Provide useful empty states and clear destructive-action
    confirmations.

## 19.3 Error handling

-   User-facing messages must be understandable and actionable.
-   Do not expose stack traces or internal secrets.
-   Preserve unsynced local work on recoverable errors.
-   Clearly distinguish offline, conflict, unauthorized, locked and
    server failure states.

------------------------------------------------------------------------

# 20. IMPLEMENTATION ROADMAP --- BUILD IN THIS ORDER

Do not attempt to implement every module in one generation. Build each
phase, run tests, and commit or checkpoint before proceeding.

## Phase 0 --- Repository inspection and project bootstrap

Deliver: - Monorepo folders. - pnpm workspace and Turborepo. -
React/Vite app. - WXT extension shell. - Go API shell. - PostgreSQL +
MinIO Docker Compose. - Health endpoints. - Environment validation. - CI
workflow. - README and AGENTS instructions.

Acceptance: - `pnpm install` succeeds. - `pnpm dev` starts web and
extension development. - Go API starts. - `GET /health/live` and
`/health/ready` work. - PostgreSQL connection succeeds. - Migrations
run. - CI executes formatting/lint/typecheck/tests.

## Phase 1 --- Domain model and API contract

Deliver: - Domain model package. - Zod validation. - OpenAPI contract. -
Initial database migrations. - API client generation/validation. -
Architecture decision records.

Acceptance: - Shared types compile. - Contract validation tests pass. -
Database migration up/down works. - No plaintext vault fields in server
domain model.

## Phase 2 --- Cryptographic protocol specification and prototype

Before implementation, create: -
`docs/architecture/CRYPTO_PROTOCOL.md` -
`docs/architecture/CRYPTO_TEST_VECTORS.md` -
`docs/architecture/CRYPTO_DECISIONS.md`

Resolve: - Canonical context encoding. - Argon2id library and calibrated
parameters. - HKDF salt and info construction. - AES-KW envelope
format. - AES-GCM AAD format. - Nonce handling. - Recovery secret
format. - Streaming AEAD library and format. - Key storage and
lifecycle. - Protocol versioning and migration.

Then implement crypto-core and tests.

Acceptance: - Test vectors pass. - Tampering and wrong-context tests
fail safely. - No custom primitive. - Security review checklist
completed. - Mark crypto as prototype until independent review.

## Phase 3 --- Account authentication and device foundation

Deliver: - Account registration/login. - Session handling. -
Passkey/WebAuthn path or documented secure initial auth fallback. -
Device registration. - Device list and revoke. - Pending enrollment
flow.

Acceptance: - Session and authorization tests pass. - Device cannot
access data while pending or revoked. - Pairing expiry/replay tests
pass.

## Phase 4 --- Vault lifecycle

Deliver: - Create independent vault. - Generate VEK. - Password
envelope. - Recovery envelope. - Unlock and lock. - Password change by
rewrapping VEK. - Recovery setup/rotation. - Local encrypted vault
metadata.

Acceptance: - Two vaults are cryptographically independent. - Unlocking
one does not unlock another. - Backend receives only envelopes and
metadata. - Recovery works in tests. - Loss limitations are
communicated.

## Phase 5 --- Local encrypted record engine

Deliver: - IndexedDB schema and migrations. - Encrypted object
repository. - Password records. - Secure notes. - Identity records. -
Payment records. - Search after local unlock. - Password generator. -
Clipboard handling. - Lock/inactivity behavior.

Acceptance: - CRUD works offline. - Stored private record payloads are
ciphertext. - Locked vault cannot decrypt. - Decrypted state clears on
lock/logout as designed.

## Phase 6 --- CMS/Admin foundation

Deliver:
- Protected Admin/CMS workspace and authorization.
- Account/tenant-scoped CRUD for modules, navigation, screens, sections, record types, custom fields and themes.
- Section ordering, visibility and safe style controls.
- Versioned configuration schemas and validation.
- Immutable revision history, audit log and restore.
- Dynamic configuration API and trusted frontend section renderer.
- Editable seed configuration and first-run owner setup.

Acceptance:
- Admin configures the user-facing application through forms, without code edits.
- Changes appear without rebuild/redeployment.
- Revision history and restore work.
- Tenant isolation and authorization tests pass.
- Unsafe HTML/CSS/JavaScript cannot be executed through CMS payloads.

## Phase 7 --- Main web application

Deliver: - Authentication screens. - Dashboard. - Vault selector and
management. - Password manager UI. - Secure notes UI. - Identity UI. -
Documents UI. - Payments UI. - Settings. - Device management. - Recovery
and backup screens. - Error/empty/loading/locked states.

Acceptance: - End-to-end workflows work with local encrypted storage. -
Responsive and accessible baseline. - No placeholder controls for
claimed features.

## Phase 8 --- Backend sync and conflict handling

Deliver: - Per-vault operation log. - Revision checks. - Idempotency. -
Cursor pagination. - Tombstones. - Conflict UI. - Offline queue and
retry.

Acceptance: - Two browser contexts/devices sync. - Concurrent edits
return conflict. - No silent last-write-wins. - Retries do not duplicate
operations. - Deletion propagates.

## Phase 9 --- Encrypted attachments and object storage

Deliver: - Reviewed streaming AEAD integration. - Client-side file
encryption. - Scoped upload/download sessions. - MinIO integration. -
Integrity checks. - Size and quota controls.

Acceptance: - Object storage contains ciphertext only. -
Tampering/truncation rejected. - Interrupted uploads can safely retry. -
Large file memory usage is controlled.

## Phase 10 --- Backup and restore

Deliver: - Versioned encrypted archive format. - Export. -
Import/restore staging. - Integrity manifest. - Restore conflict
safeguards. - User-facing recovery guidance.

Acceptance: - Backup can restore a vault on a clean test browser. -
Invalid/corrupt archives rejected. - Existing data is not silently
overwritten. - Backup metadata leakage documented.

## Phase 11 --- Chrome extension

Deliver: - MV3 extension. - Popup and background service worker. -
Secure extension authentication/session model. - Manual password
lookup/fill. - Origin allowlist. - Domain mismatch warnings. - Minimal
permissions.

Acceptance: - Extension cannot expose keys to content scripts/page. -
Manual fill works on approved test origin. - Hostile origin and iframe
tests pass. - No credential logging. - Lock/revoke behavior is verified.

## Phase 12 --- Hardening and release candidate

Deliver: - Security review. - Dependency audit. - Threat-model update. -
CSP and browser security headers. - Rate limits and quotas. -
Backup/restore tests. - Data deletion and retention behavior. -
Production deployment documentation. - User-facing security
limitations. - Release checklist.

Acceptance: - All critical/high issues addressed or explicitly
blocked. - CI green. - E2E tests green. - Security review completed by
qualified reviewer before production use. - No unsupported security
claims.

------------------------------------------------------------------------

# 21. THREAT MODEL

## 21.1 Assets

-   Vault unlock passwords.
-   Recovery secrets.
-   VEKs and DEKs.
-   Password records.
-   Identity and financial records.
-   Secure notes.
-   Documents and attachments.
-   Account sessions.
-   Device private keys.
-   Backup archives.

## 21.2 Threat actors

-   Curious or malicious backend operator.
-   Database/object-storage attacker.
-   Network attacker.
-   Malicious website.
-   Malicious browser extension.
-   XSS attacker.
-   Stolen or shared device user.
-   Malware on endpoint.
-   Malicious or compromised dependency.
-   User error (lost recovery secret, weak unlock password, unsafe
    backup).

## 21.3 Required mitigations

-   Client-side encryption.
-   Strong KDF and key hierarchy.
-   Authenticated encryption.
-   Domain-separated key derivation.
-   Device authorization.
-   Session protection.
-   Strict origin matching in extension.
-   CSP and safe rendering.
-   Minimal extension permissions.
-   Encrypted backups.
-   Explicit conflict handling.
-   Rate limiting and authorization.
-   Dependency and build integrity checks.
-   Security review.

## 21.4 Known limitations to disclose

-   A compromised endpoint can access data while unlocked.
-   XSS on the trusted app origin can potentially compromise unlocked
    vault data.
-   Browser memory and JavaScript cannot guarantee perfect secret
    zeroization.
-   Revoking a device cannot erase already downloaded ciphertext or
    copied plaintext.
-   A local browser database may be evicted or lost; it is not a backup.
-   A stolen unlocked device may expose data until it locks.
-   Metadata such as access timing, account identity, ciphertext size
    and sync activity may remain visible.
-   Old valid backups can restore older data; rollback protection has
    limits.
-   Loss of both unlock and recovery material may make a vault
    permanently unrecoverable.

------------------------------------------------------------------------

# 22. DEFINITION OF DONE

A feature is done only when: - Requirements are implemented. - UI and
API behavior are connected to real logic. - Input validation exists at
trust boundaries. - Error and loading states are implemented. - Tests
cover expected and failure paths. - No secrets are logged. -
Documentation is updated. - Accessibility basics are met for UI
features. - No dead controls or fake success messages remain. - Relevant
security implications are documented.

A phase is complete only when its acceptance criteria pass and the
implementation status is updated.

The entire product is not production-ready until the security review and
release criteria in Phase 11 are satisfied.

------------------------------------------------------------------------

# 23. AI CODING AGENT OPERATING PROMPT

Use the following as the first prompt after adding this file to the
repository:

> Read `PERSONAL_DIGITAL_VAULT_MASTER_BUILD_SPEC.md` and `AGENTS.md`
> completely. You are responsible for implementing the Personal Digital
> Vault exactly according to the master specification.
>
> First inspect the repository and report its current state. Do not
> start coding immediately. Produce: 1. A concise architecture summary.
> 2. A list of implementation phases and dependencies. 3. Any blocking
> ambiguities or security decisions that must be resolved. 4. A proposed
> initial file tree. 5. A Phase 0 task checklist with acceptance tests.
>
> Do not ask me to repeat decisions already in the specification. Make
> conservative defaults for non-blocking choices and document them.
>
> After presenting the plan, implement Phase 0 only. Keep the repository
> runnable. Run all relevant checks and tests, fix failures, and update
> `docs/IMPLEMENTATION_STATUS.md`.
>
> Do not implement fake cryptography or claim security properties that
> have not been verified. Do not proceed to later phases until Phase 0
> acceptance criteria pass and I approve continuation.
>
> At the end, report exact commands to run locally, changed files, test
> results, known limitations and the next recommended phase.

## 23.1 Prompt for subsequent phases

After approving a phase, use:

> Continue with the next incomplete phase in
> `PERSONAL_DIGITAL_VAULT_MASTER_BUILD_SPEC.md`. Re-read the relevant
> specification sections and current `docs/IMPLEMENTATION_STATUS.md`,
> inspect the actual code, and implement only that phase. Preserve
> existing working behavior. Add tests, run all relevant checks, fix
> failures, update documentation and status, and report any
> security-sensitive decisions. Do not claim completion unless
> acceptance criteria pass.

------------------------------------------------------------------------

# 24. FINAL PROJECT RULES

1.  This specification is the source of truth unless the user approves a
    documented change.
2.  Prefer security and correctness over speed or convenience.
3.  Do not implement the entire project in one uncontrolled
    code-generation pass.
4.  Keep each phase independently runnable and testable.
5.  Never put plaintext vault data or keys on the backend.
6.  Never invent cryptographic protocols.
7.  Never silently resolve sensitive record conflicts.
8.  Never promise recovery if the required key material does not exist.
9.  Do not treat a successful demo as a security audit.
10. Before production use, obtain an independent security review of
    cryptographic design, implementation, browser extension boundaries,
    authentication, recovery and backup.

------------------------------------------------------------------------

**End of master specification.**
