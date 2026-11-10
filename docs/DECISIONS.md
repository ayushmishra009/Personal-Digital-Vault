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

**Status:** Open; resolve before Phase 6<br>
**Decision:** Keep ordinary presentation configuration server-managed and versioned. Treat private custom-field labels or schemas as sensitive if their meaning reveals private information; those must not be sent in plaintext to the backend. Define client-encrypted schema behavior before CMS implementation.<br>
**Reason:** The specification both requires backend-managed CMS field definitions and forbids backend receipt of sensitive custom-field labels. The security boundary needs a specific schema classification and API model.

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
