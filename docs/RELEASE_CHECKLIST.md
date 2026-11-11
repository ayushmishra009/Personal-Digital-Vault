# Release Candidate Verification Checklist — Phase 12

**Release Candidate Target:** Version 1.0.0-rc1  
**Project:** Personal Digital Vault (PDV)

---

## 1. Phase Delivery & Verification Status

- [x] **Phase 0: Project Bootstrap & Workspace Setup**
  - Monorepo structure, pnpm workspace, Turborepo pipeline, Go API shell, PostgreSQL + MinIO Docker Compose, health endpoints (`/health/live`, `/health/ready`).
- [x] **Phase 1: Domain Model, Validation & Contracts**
  - Canonical OpenAPI 3.1 contract (`contracts/openapi.yaml`), Zod validation schemas (`@pdv/validation`), typed client generation (`@pdv/api-client`), shared domain models (`@pdv/data-models`).
- [x] **Phase 2: Cryptographic Core Protocol**
  - NIST-grade primitives, AES-256-GCM + AES-256-KW wrapping, Argon2id p=4 KDF with p=1 backward compatibility, independent 256-bit recovery secret HKDF-SHA256, protocol context encoding (`encodeContext`), 100% test vectors and negative tamper tests passing.
- [x] **Phase 3: Database Migrations & Repository Layer**
  - Go repository pattern (`MockRepository` and `PostgresRepository`), migrations 00001 through 00004, tenant scoping, soft-delete tombstones, and audit logging.
- [x] **Phase 4: Authentication, Device Authorization & Sessions**
  - Separation of account authentication, device enrollment, and vault unlocking. Session cookies (`pdv_session`), SHA-256 token hashing, device approval flow, and device revocation.
- [x] **Phase 5: Vault Lifecycle & Independent Unlocking**
  - Dual envelope architecture (`password` and `recovery`), Argon2id WASM worker integration, in-memory non-extractable VEK unwrapping, and password change rewrapping without data re-encryption.
- [x] **Phase 6: CMS Architecture & Admin Web Interface**
  - Declarative CMS schemas (`CmsModule`, `CmsSection`, `CmsNavigationItem`, `CmsThemeSettings`), schema validation with Zod, finite component registry rendering (zero arbitrary HTML/scripts), atomic revision tracking and rollback.
- [x] **Phase 7: Full Vault Web Client**
  - Responsive multi-view dashboard, PasswordsView, NotesView, IdentitiesView, PaymentsView, DocumentsView, SettingsView, DevicesView, RecoveryView, auto-lock inactivity timer, secure clipboard clearing with auto-wipe.
- [x] **Phase 8: Offline-First Synchronization & Conflict Resolution**
  - Monotonic revision tracking (`base_revision + 1`), operation idempotency, delta sync cursor, FIFO push queue, tombstone deletion, interactive `ConflictResolutionModal` with three-way resolution.
- [x] **Phase 9: Encrypted File Attachments & Object Storage**
  - Libsodium `crypto_secretstream_xchacha20poly1305` streaming AEAD, multi-chunk verification, upload/download sessions, 100 MB quota enforcement, client-side decryption download.
- [x] **Phase 10: Encrypted Backup Package & Restore Engine**
  - Single-file authenticated archive (`.pdvbackup`), deterministic rootHash manifest, clean browser recovery via password or recovery secret, safe in-memory staging area with conflict safeguards against newer data overwrites.
- [x] **Phase 11: Chrome MV3 Extension**
  - Manifest V3 with minimal permissions (`storage`, `activeTab`, `scripting`), top-level frame restriction (`allFrames: false`, `{ frameId: 0 }`), strict origin matching rejecting substring/suffix spoofing, domain mismatch warning screen with user acknowledgment, manual fill without auto-submission, zero credential logging.
- [x] **Phase 12: Production Hardening & Release Candidate**
  - Defense-in-depth API security headers (CSP, nosniff, DENY, no-store, HSTS), token bucket rate limiting (auth: 15/min, enrollment: 30/min, API: 200/min), data deletion and 30-day tombstone retention policies, `pnpm audit --prod` clean (0 vulnerabilities), complete documentation set.

---

## 2. Automated Quality Gates

| Check                  | Tool / Runner               | Result                      |
| ---------------------- | --------------------------- | --------------------------- |
| Monorepo Build         | `turbo run build`           | PASS (8/8 packages)         |
| Monorepo Typecheck     | `turbo run typecheck`       | PASS (0 errors)             |
| Monorepo Linting       | `turbo run lint`            | PASS (0 warnings, 0 errors) |
| Backend Tests          | `go test -mod=vendor ./...` | PASS (100% tests passing)   |
| Crypto Core Tests      | `node test/*.test.mjs`      | PASS (18/18 tests passing)  |
| Web Client Tests       | `vitest run` (`vault-web`)  | PASS (35/35 tests passing)  |
| Chrome Extension Tests | `vitest run` (`extension`)  | PASS (18/18 tests passing)  |
| OpenAPI Contract Lint  | `redocly lint`              | PASS (0 errors)             |
| Code Formatting        | `prettier --check .`        | PASS (clean)                |
| Dependency Audit       | `pnpm audit --prod`         | PASS (0 vulnerabilities)    |

---

## 3. Pre-Production Release Criteria

- [ ] **Independent Cryptographic Audit:** Formal review of cryptographic protocol design, WASM memory bounds, and key isolation boundaries by an independent third-party auditor before handling real personal data.
- [ ] **Production Infrastructure Hardening:** HTTPS TLS 1.3 certificates provisioned, PostgreSQL row-level security enabled, production secrets managed outside environment variables, and daily encrypted database backups configured.
- [ ] **Third-Party Calibrations:** Argon2id parameters benchmarked across target production client hardware and mobile browsers.
