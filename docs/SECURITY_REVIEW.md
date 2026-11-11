# Security Review & Audit Report — Personal Digital Vault (PDV)

**Status:** Phase 12 Internal Pre-Release Audit  
**Scope:** Cryptographic Core, Go Backend API, Web Clients, Chrome MV3 Extension, and Supply Chain.

---

## 1. Cryptographic Protocol Review

- **Primitives & Standards:**
  - Key Derivation: Argon2id (`v=19, m=65536 KiB, t=3, p=4`) with legacy support for `p=1`. Derives 256-bit AES-KW wrapping key.
  - Recovery Derivation: HKDF-SHA256 with 16-byte random salt and context info string `"PDV/1/recovery-vek-wrap"`.
  - Object Encryption: AES-256-GCM (12-byte random nonce, 128-bit tag) with per-revision DEK wrapped via AES-256-KW (NIST SP 800-38F).
  - Streaming Attachments: Libsodium `crypto_secretstream_xchacha20poly1305` chunked authenticated streaming AEAD with final frame tag validation.
  - Backup Archives: Versioned container (`formatVersion = 1`) encrypted under HKDF-derived VEK key with canonical SHA-256 root hash integrity manifest.
- **Protocol Context Binding:**
  - Binary context header (`encodeContext`): 4-byte magic (`PDV\0`), 2-byte protocol version, purpose length & string, 16-byte vault UUID, 16-byte object UUID, 8-byte revision, 4-byte payload version.
  - Guarantees: Replay across revisions, object swapping, and cross-vault context substitution are cryptographically detected and rejected.
- **Negative Test Coverage:**
  - Tampered ciphertext, bad auth tag, corrupt salt, truncated stream, out-of-order chunk, and mismatched recovery key envelope tests all fail closed with explicit errors.

---

## 2. Browser Extension Boundary Review

- **Permission Minimization:**
  - Declared permissions: `["storage", "activeTab", "scripting"]`.
  - Host permissions: Restricted exclusively to authorized API origins (`http://localhost:8080/*`, `http://127.0.0.1:8080/*`).
- **Untrusted Content Script Isolation:**
  - `allFrames: false` declared in both manifest and content script options, strictly rejecting script injection into child or third-party iframes.
  - Background worker dispatches credential fill messages targeting frame 0 (`{ frameId: 0 }`).
  - Cryptographic keys (VEK, DEKs, recovery secrets) and unrequested decrypted records are never sent to content scripts.
- **Anti-Spoofing & Domain Matching:**
  - `matchesDomain` and `extractHostname` enforce strict dot-separated domain boundaries. Substring spoofing (`evil-github.com`) and suffix spoofing (`github.com.attacker.com`) are rejected.
  - Clear domain mismatch warning screen requiring explicit user acknowledgment before cross-domain fill.
- **Zero Logging:**
  - Console logging spied and asserted; no passwords, recovery secrets, or raw keys are logged across any extension flows.
- **No Form Auto-Submission:**
  - Prototype setter triggers React/Vue synthetic events without executing `form.submit()` or simulating enter key presses.

---

## 3. Backend Authorization & API Hardening Review

- **Tenant Isolation:**
  - Every handler validates authenticated account ownership against database records.
  - Cross-tenant requests to foreign vaults, sync streams, attachments, or backups return `404 Not Found` without disclosing existence.
- **Device Authorization Boundary:**
  - Device approval workflow separates account identity from device authorization.
  - Devices with status `pending` cannot access vaults, objects, attachments, sync endpoints, or CMS admin routes (receives `403 Forbidden`).
  - Device revocation immediately invalidates active sessions and rejects subsequent API requests (`401 Unauthorized`).
- **Defense-in-Depth Headers:**
  - API enforces `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none';`.
  - Enforces `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Cache-Control: no-store`.
  - Enforces HSTS when running with TLS.
- **Rate Limiting:**
  - In-memory token bucket rate limiter protects sensitive endpoints:
    - Auth (login, register): 15 req/min.
    - Enrollment: 30 req/min.
    - General API: 200 req/min.
    - Returns RFC 7807 problem details with HTTP 429 and `Retry-After: 60`.

---

## 4. Supply Chain & Dependency Audit

- **Production Audit Result:**
  - `pnpm audit --prod`: **0 vulnerabilities**.
  - All workspace package overrides pinned cleanly.
- **Independent Security Review Gate:**
  - As mandated by Section 24 rule 10 of the Master Build Spec:
    > _"Before production use, obtain an independent security review of cryptographic design, implementation, browser extension boundaries, authentication, recovery and backup."_
  - This codebase is marked as a **Release Candidate Prototype** pending independent third-party cryptographic review.
