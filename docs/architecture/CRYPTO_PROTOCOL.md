# PDV cryptographic protocol (draft)

**Status:** PENDING SECURITY REVIEW. Proposed protocol only; not approved for production.<br>
**Protocol identifier:** `pdv-crypto-v1` (proposed; wire `protocolVersion: 1`).

This document records the proposed v1 envelope and current validation implementation. It does not authorize security claims or production use. Independent security review remains required.

## Security boundary

Vault plaintext, unlock passwords, recovery secrets, VEKs, DEKs, and decrypted attachment bytes remain in the trusted client process. API and object storage receive only opaque identifiers, minimum operational metadata, and authenticated ciphertext/key envelopes. Account login does not unlock a vault. The server holds no key needed to unwrap a VEK or decrypt a payload.

The trusted client origin and its scripts are in the vault security boundary. XSS, malicious dependencies, endpoint malware, browser memory inspection, or an unlocked stolen device can expose data. JavaScript and Web Crypto do not promise reliable zeroization. Never persist raw keys or decrypted data in localStorage, sessionStorage, ordinary IndexedDB records, logs, telemetry, or URLs.

## Algorithms and byte conventions

- Random values come from `crypto.getRandomValues` or the selected cryptographic library's CSPRNG; never fall back to `Math.random`.
- Password KDF: proposed Argon2id v1.3, 32-byte output, RustCrypto `argon2` 0.6.0 compiled to WASM. The implementation is a candidate and PENDING SECURITY REVIEW.
- New password envelopes use exactly memory 65,536 KiB, iterations 3, parallelism 4, and a 16-byte salt. Existing p=1 envelopes with the same remaining tuple remain unlockable. New envelope creation is fixed to p=4; unsupported tuples fail closed. No silent downgrade or fallback is allowed.
- Execute derivation in a dedicated Web Worker. Browser-level WASM threading is not required. Cancellation terminates the worker; cancellation is not cooperative during the synchronous KDF and memory reclamation is best effort. The candidate currently caps password byte length at 1 MiB.
- HKDF: HKDF-SHA-256, 32-byte output. Use Web Crypto.
- Record AEAD: AES-256-GCM, 12-byte random nonce, 128-bit tag. Use Web Crypto.
- Key wrapping: AES-256-KW via Web Crypto, only for 32-byte AES keys. KW is not used for record data.
- Large attachment streams: candidate `crypto_secretstream_xchacha20poly1305` through maintained libsodium.js wrappers. The wire format is separate and requires framing, final-tag/truncation rules, and browser build review before implementation. Never substitute chunked AES-GCM or hand-roll streaming.
- Passwords use UTF-8 bytes exactly as entered; passwords are not trimmed or Unicode-normalized. NFC and NFD strings therefore remain distinct. Lone UTF-16 surrogates are rejected rather than encoded as replacement characters. JSON payloads use RFC 8785 JSON Canonicalization Scheme UTF-8 bytes. Base64url wire values are unpadded and must decode canonically.

Unknown identifiers, versions, malformed encodings, out-of-range KDF parameters, and unsupported migrations fail closed.

## Key hierarchy

Each vault receives an independent uniformly random 32-byte Vault Encryption Key (VEK). Independent password and recovery envelopes each wrap the same VEK using separate derivation inputs. Neither envelope contains plaintext key bytes.

For each object revision, generate a fresh independent 32-byte Data Encryption Key (DEK). Encrypt the canonical payload with AES-256-GCM under the DEK. Derive an object-specific AES-KW key from the VEK using HKDF-SHA-256, then wrap the DEK. A fresh DEK per revision avoids AES-GCM nonce reuse across revisions by construction; the nonce remains independently random.

### Password envelope

1. Generate a fresh 16-byte salt.
2. Run Argon2id v1.3 over the exact UTF-8 password with the approved stored parameter tuple to produce a 32-byte password-derived key (PDK).
3. Import the PDK as a non-extractable AES-KW key and wrap the raw VEK bytes. Web Crypto does not allow HKDF keys to be extractable; the implementation temporarily represents VEK bytes as an extractable AES-KW key solely to perform AES-KW wrapping. The operational VEK is imported separately as a non-extractable HKDF key.
4. Retain only KDF identifier, bounded parameters, salt, algorithm identifiers, protocol version, and wrapped VEK. Clear temporary byte arrays on a best-effort basis.

### Recovery envelope

Generate 32 random bytes as the recovery secret. Encode using unpadded base64url for v1 and show it once with instructions to store offline. No email or account-login recovery bypass exists. Generate a fresh 16-byte salt and derive a 32-byte recovery wrapping key with HKDF-SHA-256 using recovery bytes as IKM, that salt, and exact UTF-8 info `PDV/1/recovery-vek-wrap`. Import as non-extractable AES-KW and wrap the VEK. Recovery material is never sent to the backend. This is machine-oriented; a human-friendly encoding needs a separate reviewed decision.

The password envelope salt is the Argon2id salt (16 bytes); the recovery envelope salt is the HKDF salt (16 bytes). AES-KW wrapped values are exactly 40 bytes for a 32-byte key, encoded canonical unpadded base64url. Unlock returns the VEK as a non-extractable HKDF key with derive-key usage. Password change or KDF migration unwraps the same raw VEK, wraps it under a fresh p=4 KEK and salt, then clears temporary exported bytes best effort. The caller retains the recovery envelope unchanged. Existing encrypted records are not re-encrypted. Failed unwraps produce a generic unlock failure and must not reveal password-vs-corruption distinctions in remote responses or logs.

### Password change and KDF migration

An existing p=1 envelope is read using its stored exact tuple. After successful unlock, password change or migration derives a fresh p=4 KEK and salt and rewraps the same 32-byte VEK. No object DEK, ciphertext, nonce, object envelope, or recovery envelope is modified. The client should verify the new envelope by unlocking it before replacing the old envelope. The old envelope should remain available until the replacement is durably confirmed. p=1 remains available for unlock during the compatibility period; it is never selected as fallback when a p=4 operation fails.

## Canonical context and authenticated data

Do not serialize context as JSON. AES-GCM AAD and HKDF info use this binary encoding:

```text
ASCII "PDV" || 0x00
u16be(protocolVersion)
u8(purposeByteLength) || purpose ASCII bytes
vaultId (UUID as 16 network-order bytes)
objectId (UUID as 16 network-order bytes)
u64be(revision)
u32be(payloadVersion)
```

For v1, `purpose` is a strict allowlisted ASCII token; records use `record`. Reject non-UUID identifiers, non-ASCII/empty/oversized purposes, zero/overflow versions, and invalid revisions. UUID text is parsed into bytes, so textual case and hyphen representation cannot alter context.

Use the exact context bytes as AES-GCM AAD. For wrapping, HKDF uses `salt = vaultId bytes` and `info = ASCII "PDV/1/object-dek-wrap" || 0x00 || contextBytes`; its 32-byte output is the AES-KW key. Ciphertext and wrapped key are bound to vault, object, revision, purpose, payload version, and protocol version. Duplicated envelope context fields must match exactly; derive context from validated envelope fields, never a caller-supplied context blob.

## Encrypted object envelope

The v1 object envelope uses the Phase 1 JSON shape with fixed identifiers `AES-256-GCM` and `AES-256-KW`, version 1, UUID vault/object IDs, positive revision and payload version, allowlisted purpose, 12-byte nonce, 40-byte wrapped DEK, and ciphertext of at least 16 bytes (the GCM tag). Ciphertext contains canonical RFC 8785 JSON UTF-8 plaintext. Private title, URL, category, tags, custom schema labels, and record fields belong only inside ciphertext.

Before decryption, validate the complete envelope, lengths, canonical base64url, supported algorithm/version, and context fields. Authenticate before parsing plaintext. On authentication or parse error, return one generic invalid-ciphertext error and no partial plaintext. AAD mismatch, modified nonce/tag/ciphertext, cross-context use, or wrong key must fail.

## Nonces, revisions, and replay

Use a fresh CSPRNG 96-bit nonce for every AES-GCM operation. A new DEK is mandatory for every object revision; never retry encryption with a DEK after an uncertain failure. Persist the complete envelope atomically. Server revision checks prevent concurrent overwrite but do not cryptographically prevent rollback to a previously valid envelope. Clients must surface rollback/conflict signals; stronger rollback resistance needs a separately reviewed authenticated checkpoint design.

## Lifecycle and migration

Keep VEKs and unwrapped keys in memory only while unlocked; clear references and transient buffers on lock, logout, inactivity timeout, and errors, while acknowledging browser zeroization limits. Do not send keys to content scripts or page origins. Extension crypto remains in the trusted extension context; page-facing messages expose only narrowly scoped fill operations after explicit user action.

Version 1 readers reject unknown versions. Never downgrade. Future migration decrypts locally with a supported old reader, creates new envelopes/ciphertext under the new protocol, preserves old revisions until confirmed, and reports failures without discarding local data. Protocol migration is not an API-server operation.

## Streaming attachments

The proposed library is `libsodium-wrappers` 0.8.4 using `crypto_secretstream_xchacha20poly1305`; pin and review its package integrity before use. The proposed stream wire format is:

```text
8 bytes: ASCII "PDVSTRM" || 0x00
u16be: protocol version (1)
24 bytes: secretstream header
repeated frames:
  u32be: ciphertext frame length (17 through 1,048,593)
  bytes: secretstream ciphertext frame
```

Use a fresh random 32-byte stream key per attachment revision. Wrap it with the same object-specific HKDF/AES-KW method, with purpose `attachment`, attachment ID as `objectId`, and attachment revision in context. Use plaintext chunks of at most 1 MiB. Per-frame associated data is `ASCII "PDV/1/attachment-chunk" || 0x00 || contextBytes || u64be(chunkIndex)`. The final stream message must carry secretstream's `TAG_FINAL`; an empty attachment is one empty plaintext final frame. Frame length must match the stream output and remain within the stated bounds.

The reader rejects bad magic/version, invalid header, truncated/oversized frames, authentication failure, missing final tag, any frame after final, trailing bytes, and chunk-index overflow. The caller must not expose decrypted bytes until a final tag is authenticated; write to a temporary client-local sink and discard it entirely on failure. Framing reveals approximate encrypted size and frame count. This proposed format still requires executable vectors, package/browser review, and negative tests before implementation.

## Review gates

Before freezing or shipping: review binary context and RFC 8785; benchmark and cap Argon2id on supported Chrome devices; select and pin exact libraries; complete stream framing; create executable known-answer and negative vectors; review API schemas against fixed lengths/algorithm IDs; and complete independent cryptographic design review. This prototype is not independently reviewed.
