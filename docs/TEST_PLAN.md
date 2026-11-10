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

## Later security and product coverage

Follow the master specification's crypto known-answer and negative tests, backend authorization/tenant isolation tests, offline/conflict tests, CMS schema/revision tests, attachment ciphertext checks, extension origin-boundary tests, and end-to-end flows. Round-trip crypto tests alone are insufficient. Do not use production data in tests.
