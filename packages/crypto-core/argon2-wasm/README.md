# Argon2id WASM candidate

This crate is a Phase 2 validation candidate for the `Argon2idProvider` boundary. The TypeScript Worker provider can call its p=1 legacy and p=4 proposed entry points, but no application flow uses it. It is not approved for vault use; protocol status remains **PENDING SECURITY REVIEW**.

## Build and run

From the repository root, with stable Rust and `wasm32-unknown-unknown` installed:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo test --locked --manifest-path packages/crypto-core/argon2-wasm/Cargo.toml
cargo build --locked --release --target wasm32-unknown-unknown --features test-vectors --manifest-path packages/crypto-core/argon2-wasm/Cargo.toml
node packages/crypto-core/argon2-wasm/browser/run-chrome.mjs
node packages/crypto-core/argon2-wasm/browser/run-chrome-worker.mjs
node packages/crypto-core/test/run-chrome-provider.mjs
```

The `test-vectors` feature adds a low-memory KAT-only export. A production candidate build must omit that feature. The browser page checks the upstream low-memory KAT, p=1 legacy and p=4 proposed exact vectors, malformed arguments, and WebAssembly loading in Chrome. The separate Worker runner checks six p=4 derivations, p=1 compatibility, responsiveness, malformed-input reporting, and termination while a synchronous derivation is running. These harnesses use synthetic inputs and isolated temporary Chrome profiles. Proposed new envelopes use Argon2id v1.3 with `m=65,536 KiB`, `t=3`, `p=4`, a 16-byte salt, and 32-byte output; existing p=1 envelopes remain unlockable. Browser-level WASM multithreading is disabled.

## Review limits

- This is a narrow unsafe C ABI and a validation-only Worker provider, not connected to product flows.
- Derivation is synchronous. Production integration must execute it in a dedicated worker so the 64 MiB, three-pass derivation does not block the Vault UI.
- The exported pointer functions are unsafe FFI. Callers must pass live allocations created by this module, the exact original lengths, and free each pointer once.
- Input and output buffers are cleared when freed, and the Argon2 crate's `zeroize` feature is enabled. JavaScript copies, engine internals, and browser memory cannot be proven zeroized.
- The prototype caps a password buffer at 1 MiB; that is an implementation limit and requires protocol/product review before adoption.
- Build success and vectors do not constitute independent cryptographic review or a security claim.
