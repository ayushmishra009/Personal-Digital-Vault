import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const browserDir = dirname(fileURLToPath(import.meta.url));
const crateDir = dirname(browserDir);
const wasmPath = join(
  crateDir,
  "target",
  "wasm32-unknown-unknown",
  "release",
  "pdv_argon2_wasm_candidate.wasm",
);
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath));
const wasm = instance.exports;

function allocate(bytes) {
  const pointer = wasm.pdv_alloc(bytes.length);
  assert.notEqual(pointer, 0, "WASM allocation succeeds");
  new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
  return pointer;
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

const password = new TextEncoder().encode("password");
const salt = new TextEncoder().encode("somesalt");
const candidateSalt = new TextEncoder().encode("0123456789abcdef");
const expectedPdvP1 =
  "daf16780dcb73e862146297fa17b81b86b480f33c0b67daef0f2c7c809c5797b";
const expectedPdvP4 =
  "b8a64b68dea6b88ca8c8862be706aac37cbecda0db7bd68b48f8fa2e7feb6f3e";
const passwordPointer = allocate(password);
const saltPointer = allocate(salt);
const candidateSaltPointer = allocate(candidateSalt);
const outputPointer = wasm.pdv_alloc(32);
assert.notEqual(outputPointer, 0, "output allocation succeeds");

try {
  assert.equal(
    wasm.pdv_test_kat(
      passwordPointer,
      password.length,
      saltPointer,
      salt.length,
      outputPointer,
      32,
    ),
    0,
    "KAT call succeeds",
  );
  assert.equal(
    hex(new Uint8Array(wasm.memory.buffer, outputPointer, 32)),
    "9dfeb910e80bad0311fee20f9c0e2b12c17987b4cac90c2ef54d5b3021c68bfe",
    "Argon2id v1.3 known answer matches",
  );
  assert.equal(
    wasm.pdv_derive_key(
      passwordPointer,
      password.length,
      candidateSaltPointer,
      candidateSalt.length,
      outputPointer,
      32,
    ),
    0,
    "fixed PDV tuple succeeds",
  );
  assert.equal(
    hex(new Uint8Array(wasm.memory.buffer, outputPointer, 32)),
    expectedPdvP1,
    "legacy p=1 envelope tuple vector matches",
  );
  assert.equal(
    wasm.pdv_derive_key_p4(
      passwordPointer,
      password.length,
      candidateSaltPointer,
      candidateSalt.length,
      outputPointer,
      32,
    ),
    0,
    "proposed p=4 tuple succeeds",
  );
  assert.equal(
    hex(new Uint8Array(wasm.memory.buffer, outputPointer, 32)),
    expectedPdvP4,
    "proposed p=4 tuple vector matches",
  );
  assert.equal(
    wasm.pdv_derive_key(1, 1, 1, 0, outputPointer, 32),
    1,
    "invalid lengths reject",
  );
  assert.equal(
    wasm.pdv_alloc(1_048_577),
    0,
    "oversized input allocation rejects",
  );
  console.log(
    "PASS: Node WebAssembly KAT, p=1 compatibility, p=4 vector, and malformed-input checks.",
  );
} finally {
  wasm.pdv_free(passwordPointer, password.length);
  wasm.pdv_free(saltPointer, salt.length);
  wasm.pdv_free(candidateSaltPointer, candidateSalt.length);
  wasm.pdv_free(outputPointer, 32);
}
