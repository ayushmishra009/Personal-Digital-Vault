# Threat Model — Personal Digital Vault (PDV)

**Version:** 1.0 (Phase 12 Release Candidate)  
**Authority:** `PERSONAL_DIGITAL_VAULT_MASTER_BUILD_SPEC_v1.1.md` (Section 21)

---

## 1. System Assets

| Asset                                      | Sensitivity | Location                                      | Protection Mechanism                                                                    |
| ------------------------------------------ | ----------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Vault Unlock Password**                  | Critical    | Client memory only (during unlock)            | Never transmitted; Argon2id KDF derivation client-side.                                 |
| **Recovery Secret (256-bit)**              | Critical    | Client display / User storage                 | Encoded as base64url; HKDF-SHA256 wraps independent recovery VEK.                       |
| **Vault Encryption Key (VEK)**             | Critical    | Volatile memory in web app & extension worker | 256-bit random key; never stored unencrypted; non-extractable in WebCrypto.             |
| **Data Encryption Keys (DEKs)**            | Critical    | Ephemeral in client memory                    | Unique 256-bit key per object revision; AES-KW wrapped under VEK.                       |
| **Vault Records (Passwords, Notes, etc.)** | Critical    | Client IndexedDB / Backend database           | AES-256-GCM encrypted payload; authenticated with AAD binding.                          |
| **File Attachments**                       | High        | MinIO / RustFS Object Storage                 | Libsodium `crypto_secretstream_xchacha20poly1305` chunked streaming AEAD.               |
| **Account Sessions & Cookies**             | High        | Browser HttpOnly cookie / DB token hash       | 32-byte cryptographic random token; SHA-256 hashed in database; HttpOnly, SameSite=Lax. |
| **Device Private Keys**                    | Critical    | Client WebAuthn / Local secure hardware       | Passkey/WebAuthn public key registered on server; private key non-exportable.           |
| **Backup Packages (.pdvbackup)**           | Critical    | Local filesystem / User destination           | AES-256-GCM + HKDF-SHA256 authenticated archive with rootHash manifest.                 |

---

## 2. Threat Actors & Capabilities

1. **Curious or Compromised Backend Operator:**
   - _Capabilities:_ Full read/write access to PostgreSQL database, MinIO object storage, API server memory, and server logs.
   - _Defense:_ Zero-knowledge client-side encryption. The server only receives opaque ciphertext, salts, nonces, and wrapped key envelopes. Plaintext titles, URLs, notes, and credentials are never sent to the backend.
2. **Network Attacker (Man-in-the-Middle):**
   - _Capabilities:_ Eavesdrops or tampers with traffic between browser and server.
   - _Defense:_ TLS (HTTPS) with HSTS (`max-age=63072000; includeSubDomains; preload`). Client-side authenticated encryption (AEAD) ensures ciphertext tampering fails closed.
3. **Malicious Website / Phishing Attacker:**
   - _Capabilities:_ Hosts deceptive web pages; attempts to lure browser extension into filling stored credentials.
   - _Defense:_ Strict origin matching (`matchesDomain`) rejecting substring spoofing (`evil-example.com`) and suffix spoofing (`example.com.attacker.com`). Clear domain mismatch warning screen requiring explicit user acknowledgment.
4. **Malicious Browser Extension / Untrusted Content Scripts:**
   - _Capabilities:_ Injected into page DOM or cross-origin iframes; attempts to steal credentials or cryptographic keys.
   - _Defense:_ Extension content script declared with `allFrames: false` (strictly top-level browsing context only). Background service worker dispatches strictly to `frameId: 0`. Keys (VEK, DEK) are never shared with content scripts; only the single user-approved fill payload is dispatched. No automatic form submission.
5. **Cross-Site Scripting (XSS) Attacker:**
   - _Capabilities:_ Injects script into application origin.
   - _Defense:_ Strict Content Security Policy (`default-src 'self' 'wasm-unsafe-eval'`), safe React rendering, finite component registry for CMS payloads, Markdown sanitized with no arbitrary HTML rendering.
6. **Stolen or Shared Device User:**
   - _Capabilities:_ Physical access to device while logged in.
   - _Defense:_ Configurable inactivity auto-lock timeout (5m, 15m, 30m, 60m), independent vault lock/unlock, zeroization of memory upon lock, remote device revocation via active authorized devices.

---

## 3. Required Mitigations & Verification

| Mitigation                | Architecture Component              | Verification Status                                                           |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| Client-Side AEAD          | `packages/crypto-core`              | Verified: AES-256-GCM + AES-KW test vectors pass                              |
| Calibrated Argon2id       | `packages/crypto-core/argon2-wasm`  | Verified: p=4 KAT vectors pass; p=1 legacy backward compatibility             |
| Domain-Separated Context  | `encodeContext` binary binding      | Verified: Cross-context tampering and revision swap fail closed               |
| Independent Recovery      | `unwrapVekWithRecovery`             | Verified: Recovery secret restores vault without password                     |
| Minimal Permissions       | `apps/extension/wxt.config.ts`      | Verified: `["storage", "activeTab", "scripting"]`                             |
| Top-Level Frame Isolation | `entrypoints/content.ts`            | Verified: `allFrames: false`, `{ frameId: 0 }`                                |
| Safe Credential Fill      | `dom-fill.ts`                       | Verified: Prototype setter used; zero automatic form submission               |
| Rate Limiting & Quotas    | `apps/api/internal/middleware`      | Verified: Auth (15/min), Enrollment (30/min), General (200/min), 429 response |
| Strict Security Headers   | `apps/api`, `apps/vault-web`        | Verified: CSP, nosniff, DENY, no-store, HSTS                                  |
| Tamper-Proof Backups      | `packages/crypto-core/src/index.ts` | Verified: Root hash verification, clean browser restore                       |

---

## 4. Known Real-World Limitations Disclosed to Users

1. **Compromised Endpoint:** Malware running on the endpoint (e.g. keylogger, memory scraper) can access plaintext data while the vault is unlocked.
2. **Volatile Memory Persistence:** Modern JavaScript engines and garbage collectors cannot guarantee instantaneous hardware-level zeroization of immutable strings or buffers in RAM.
3. **Stolen Unlocked Device:** If a device is stolen while unlocked, data remains exposed until the configured auto-lock timeout expires.
4. **Metadata Visibility:** Network observers and backend operators can observe access timing, account identity, ciphertext size, and sync activity.
5. **Loss of Both Keys:** If both the master password and 256-bit recovery secret are lost, the vault is mathematically and permanently unrecoverable. No administrative backdoor or email reset exists.
6. **External Backup Copies:** Exported `.pdvbackup` packages remain under user custody; deleting records or accounts on the server does not modify or delete external offline files.
