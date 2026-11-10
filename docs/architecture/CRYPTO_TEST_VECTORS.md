# Cryptographic test vectors and verification plan

**Status:** The isolated Argon2 candidate KAT and a PDV context-encoding candidate vector are executable in crypto-core. The context bytes match a separate Node `Buffer` reconstruction; independent protocol/security review remains outstanding. Remaining PDV vectors and security review are incomplete; Phase 2 is not accepted.

Every implementation must verify primitive known-answer vectors and PDV protocol vectors. Round-trip tests alone are insufficient. Use fixed synthetic values only.

## Primitive known-answer sources

- HKDF-SHA-256: [RFC 5869, Appendix A](https://www.rfc-editor.org/rfc/rfc5869.html#appendix-A).
- AES-KW: [RFC 3394, Section 4](https://www.rfc-editor.org/rfc/rfc3394.html#section-4), plus unwrap failure cases.
- AES-GCM: NIST SP 800-38D known-answer vectors, including empty plaintext/AAD, non-empty AAD, and authentication failures.
- Argon2id: [RFC 9106, Section 5.3](https://www.rfc-editor.org/rfc/rfc9106.html#section-5.3), matching variant, version, lanes, memory, iterations, salt, and output length.
- Argon2id candidate KAT used here: RustCrypto's [`argon2` v0.6.0 KATs](https://github.com/RustCrypto/password-hashes/blob/master/argon2/tests/kat.rs), derived from the PHC winner reference implementation. This supplements, but does not replace, the RFC 9106 vector that includes optional secret and associated-data inputs not exposed by this candidate API.
- Streaming: official libsodium secretstream documentation and fixed vectors from the pinned implementation; verify framing separately.

Published primitive vectors do not validate PDV encoding or key hierarchy.

### HKDF-SHA-256, RFC 5869 test case 1

```text
IKM:  0b repeated 22 times
salt: 000102030405060708090a0b0c
info: f0f1f2f3f4f5f6f7f8f9
L:    42
PRK:  077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5
OKM:  3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865
```

### Argon2id v1.3, RustCrypto candidate KAT

```text
Password: "password" (UTF-8)
Salt:     "somesalt" (UTF-8; 8 bytes)
Version:  19
Memory:   65,536 KiB
Passes:   2
Lanes:    1
Output:   32 bytes
Expected: 09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7
```

This KAT is from the Argon2 crate's upstream test suite and checks the Argon2id v1.3 result for the PHC reference parameters. It does not independently review the crate or validate the PDV v1 tuple (`m=65,536 KiB, t=3, p=1`).

### Legacy PDV Argon2id v1.3 tuple (p=1)

```text
Password: "password" (UTF-8 bytes: 70617373776f7264)
Salt:     "0123456789abcdef" (16 ASCII bytes)
Version:  19
Memory:   65,536 KiB
Passes:   3
Lanes:    1
Output:   32 bytes
Expected: daf16780dcb73e862146297fa17b81b86b480f33c0b67daef0f2c7c809c5797b
```

This deterministic synthetic vector was generated with RustCrypto `argon2` 0.6.0 and cross-checked with independent Go `golang.org/x/crypto/argon2` v0.37.0 (`IDKey`). Both produced this 32-byte output for version 19, memory 65,536 KiB, time cost 3, and parallelism 1. It is retained for unlock compatibility only. This vector does not approve the protocol.

### Proposed PDV Argon2id v1.3 tuple (p=4; PENDING SECURITY REVIEW)

Using the same password, salt, version, memory, time cost, and output length, but `p=4`, RustCrypto and Go x/crypto independently produced:

```text
b8a64b68dea6b88ca8c8862be706aac37cbecda0db7bd68b48f8fa2e7feb6f3e
```

This output was independently cross-checked between RustCrypto `argon2` 0.6.0 and Go x/crypto v0.37.0 (`IDKey`). It is tested in Rust/WASM, Node WASM, Chrome main-thread, and Chrome Worker harnesses. This is a primitive vector, not independent security approval.

### Argon2id v1.3, low-memory Chrome smoke KAT

```text
Password: "password" (UTF-8)
Salt:     "somesalt" (UTF-8; 8 bytes)
Version:  19
Memory:   256 KiB
Passes:   2
Lanes:    1
Output:   32 bytes
Expected: 9dfeb910e80bad0311fee20f9c0e2b12c17987b4cac90c2ef54d5b3021c68bfe
```

This upstream RustCrypto KAT is used by the Chrome smoke harness to confirm browser WASM execution. It is not the production PDV parameter tuple.

### PDV context encoding candidate vector

This fixture follows the encoding in `CRYPTO_PROTOCOL.md`. It runs as an executable crypto-core test with negative field checks. The expected bytes also match a separate Node `Buffer` reconstruction using explicit big-endian integer writes; this checks the encoding independently from the TypeScript helper but does not constitute an independent protocol or security review.

```json
{
  "context": {
    "protocolVersion": 1,
    "purpose": "record",
    "vaultId": "00112233-4455-6677-8899-aabbccddeeff",
    "objectId": "10213243-5465-7687-98a9-bacbdcedfe0f",
    "revision": 3,
    "payloadVersion": 1
  },
  "encodedHex": "504456000001067265636f726400112233445566778899aabbccddeeff102132435465768798a9bacbdcedfe0f000000000000000300000001"
}
```

## Required PDV golden vectors

Crypto-core work must create deterministic fixtures with all inputs and outputs committed and independently cross-checked:

1. Context encoding for fixed version, purpose, UUIDs, revision, and payload version; exact encoded hex.
2. RFC 8785 plaintext bytes for a synthetic record, including Unicode, number formatting, and key ordering.
3. Password envelope with fixed password bytes, salt, Argon2id parameters, VEK, and expected PDK/wrapped VEK. An executable p=4 fixture now exists in `packages/crypto-core/test/envelopes.test.mjs`; independent envelope-level cross-check remains pending.
4. Recovery envelope with fixed recovery bytes and salt, expected HKDF output and wrapped VEK. An executable fixture exists in the same test; independent cross-check remains pending.
5. Object envelope with fixed VEK, vault/object IDs, revision, payload, DEK, and nonce; expected wrapping key, wrapped DEK, AAD, ciphertext, and decoded envelope.
6. Cross-context cases: opening with a different vault, object, revision, purpose, payload version, or protocol version must fail.

Fixtures should be independently generated/checked using an implementation different from crypto-core where practical. Do not label an output as a known-answer vector until independently verified.

### Current envelope fixture input/output

The executable fixture uses RustCrypto WASM for Argon2id and Web Crypto for HKDF/AES-KW. Deterministic random bytes are assigned sequentially: VEK `00..1f`, recovery secret `20..3f`, password salt `40..4f`, recovery salt `50..5f`. Password is `päss🔐` encoded as UTF-8. Resulting p=4 password envelope has salt `QEFCQ0RFRkdISUpLTE1OTw` and wrapped VEK `-sUnFpAk4ctosqxzWFCAzvqAe3nBr6o8WwQKdBCwuVKRSZjzgEVltQ`. Recovery envelope has salt `UFFSU1RVVldYWVpbXF1eXw` and wrapped VEK `s2HTi-7e7OCBDzaXUY4HlrE4gZQDpRDLfgFUaaRK_IR3qfTb87NyHg`. These values match in the Node test and the actual Chrome Worker integration harness, which runs Chrome Web Crypto independently against the same deterministic inputs. This cross-browser agreement supplements, but does not replace, an independent protocol/security review.

## Required negative and boundary tests

- Wrong password/recovery secret; wrong salt; corrupted wrapped VEK.
- Modified AES-GCM nonce, ciphertext, tag, or context; truncated ciphertext; ciphertext shorter than a tag.
- Invalid/noncanonical base64url, wrong byte lengths, malformed UUIDs, unknown algorithm/protocol versions, unsupported KDF values, excessive KDF allocations, invalid purpose, and integer overflow.
- Cross-vault, cross-object, cross-revision, and cross-purpose substitution.
- Fresh DEK on every revision; no retry/reuse on failure paths.
- Unknown payload schemas and invalid canonical JSON handling.
- Later stream support: reorder, duplicate, truncate, append after final, omit final tag, corrupt header/chunk/tag, and empty stream.
- Lock/logout/error lifecycle: no retained exported raw key/plaintext references in managed state; document that JavaScript cannot prove physical zeroization.

## Acceptance status

The crypto-core envelope tests cover password/recovery envelopes, KDF compatibility and migration, Worker lifecycle, the context-encoding candidate vector with invalid-field cases, and object-envelope wrong-key, bit-flip, context-substitution, encoding, and truncation rejection cases. The context bytes also match a separate Node `Buffer` encoding cross-check. The isolated Argon2 candidate's KAT does not validate all PDV envelope operations. Deterministic object-envelope golden outputs, broader boundary coverage, and independent security review remain open. Do not claim Phase 2 acceptance until the complete known-answer, wrong-context, tampering, and malformed-input suite passes in CI and the security review checklist is complete.
