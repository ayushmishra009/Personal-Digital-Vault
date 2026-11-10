import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createVekEnvelopes,
  unwrapVekWithPassword,
  unwrapVekWithRecovery,
  importVek,
  sealObject,
  sealBackupPackage,
  openBackupPackage,
  computeDigest,
  decodeRecoverySecret,
  decodeBase64Url,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(
  here,
  "..",
  "argon2-wasm",
  "target",
  "wasm32-unknown-unknown",
  "release",
  "pdv_argon2_wasm_candidate.wasm",
);
const module = await WebAssembly.compile(readFileSync(wasmPath));

const provider = {
  async deriveKey(password, salt, parameters) {
    const instance = await WebAssembly.instantiate(module, {});
    const wasm = instance.exports;
    const alloc = (bytes) => {
      const length = Math.max(bytes.byteLength, 1);
      const ptr = wasm.pdv_alloc(length);
      assert.notEqual(ptr, 0);
      new Uint8Array(wasm.memory.buffer, ptr, length).set(bytes);
      return [ptr, length];
    };
    const [pwPtr, pwAlloc] = alloc(password);
    const [saltPtr, saltAlloc] = alloc(salt);
    const outPtr = wasm.pdv_alloc(32);
    assert.notEqual(outPtr, 0);
    try {
      const derive =
        parameters.parallelism === 4
          ? wasm.pdv_derive_key_p4
          : wasm.pdv_derive_key;
      assert.equal(
        derive(
          pwPtr,
          password.byteLength,
          saltPtr,
          salt.byteLength,
          outPtr,
          32,
        ),
        0,
      );
      return new Uint8Array(wasm.memory.buffer, outPtr, 32).slice();
    } finally {
      wasm.pdv_free(pwPtr, pwAlloc);
      wasm.pdv_free(saltPtr, saltAlloc);
      wasm.pdv_free(outPtr, 32);
    }
  },
};

const TEST_VAULT_ID = "11111111-1111-4111-8111-111111111111";
const TEST_SNAPSHOT_ID = "99999999-9999-4999-8999-999999999999";
const TEST_PASSWORD = "Correct Horse Battery Staple!42";

test("backup package seal and open roundtrip with integrity verification", async () => {
  const { vek, passwordEnvelope, recoveryEnvelope, recoverySecret } =
    await createVekEnvelopes(TEST_PASSWORD, provider);

  // Create two sample records
  const recContext1 = {
    protocolVersion: 1,
    purpose: "vault-record",
    vaultId: TEST_VAULT_ID,
    objectId: "aaaa0001-0000-4000-8000-000000000001",
    revision: 1,
    payloadVersion: 1,
  };
  const env1 = await sealObject(vek, recContext1, {
    title: "Email Account",
    password: "secretpassword1",
  });
  const hash1 = await computeDigest(decodeBase64Url(env1.ciphertext));

  const recContext2 = {
    protocolVersion: 1,
    purpose: "vault-record",
    vaultId: TEST_VAULT_ID,
    objectId: "aaaa0002-0000-4000-8000-000000000002",
    revision: 2,
    payloadVersion: 1,
  };
  const env2 = await sealObject(vek, recContext2, {
    title: "Bank Account",
    password: "secretpassword2",
  });
  const hash2 = await computeDigest(decodeBase64Url(env2.ciphertext));

  const records = [
    {
      objectId: recContext1.objectId,
      revision: 1,
      payloadVersion: 1,
      envelope: env1,
      ciphertextHash: hash1,
      updatedAt: "2026-11-10T12:00:00Z",
    },
    {
      objectId: recContext2.objectId,
      revision: 2,
      payloadVersion: 1,
      envelope: env2,
      ciphertextHash: hash2,
      updatedAt: "2026-11-10T12:05:00Z",
    },
  ];

  const attachments = [
    {
      attachmentId: "bbbb0001-0000-4000-8000-000000000001",
      ciphertextSize: 55,
      ciphertextDigest: "test-digest-1",
      updatedAt: "2026-11-10T12:00:00Z",
    },
  ];

  const pkg = await sealBackupPackage(vek, {
    vaultId: TEST_VAULT_ID,
    snapshotId: TEST_SNAPSHOT_ID,
    createdAt: "2026-11-10T12:10:00Z",
    keyEnvelopes: [passwordEnvelope, recoveryEnvelope],
    syncCursor: "seq-42",
    records,
    attachments,
  });

  assert.equal(pkg.formatVersion, 1);
  assert.equal(pkg.vaultId, TEST_VAULT_ID);
  assert.equal(pkg.snapshotId, TEST_SNAPSHOT_ID);
  assert.equal(pkg.manifestSummary.recordCount, 2);
  assert.equal(pkg.manifestSummary.attachmentCount, 1);
  assert.ok(pkg.manifestSummary.rootHash.length >= 32);

  // Roundtrip decrypt and open
  const opened = await openBackupPackage(pkg, vek);
  assert.equal(opened.vaultId, TEST_VAULT_ID);
  assert.equal(opened.snapshotId, TEST_SNAPSHOT_ID);
  assert.equal(opened.syncCursor, "seq-42");
  assert.equal(opened.records.length, 2);
  assert.equal(opened.attachments.length, 1);
  assert.equal(opened.manifest.rootHash, pkg.manifestSummary.rootHash);

  // Clean test browser scenario: decrypt using only password envelope from package
  const pEnv = pkg.keyEnvelopes.find((e) => e.envelopeType === "password");
  assert.ok(pEnv);
  const restoredVek = await unwrapVekWithPassword(
    TEST_PASSWORD,
    pEnv,
    provider,
  );
  const cleanBrowserOpened = await openBackupPackage(pkg, restoredVek);
  assert.equal(cleanBrowserOpened.records.length, 2);

  // Clean test browser scenario 2: decrypt using recovery envelope and recovery secret
  const rEnv = pkg.keyEnvelopes.find((e) => e.envelopeType === "recovery");
  assert.ok(rEnv);
  const recoveryVek = await unwrapVekWithRecovery(recoverySecret, rEnv);
  const recoveryOpened = await openBackupPackage(pkg, recoveryVek);
  assert.equal(recoveryOpened.records.length, 2);
});

test("backup package rejects tampering and corrupted archives", async () => {
  const { vek, passwordEnvelope, recoveryEnvelope } = await createVekEnvelopes(
    TEST_PASSWORD,
    provider,
  );

  const pkg = await sealBackupPackage(vek, {
    vaultId: TEST_VAULT_ID,
    snapshotId: TEST_SNAPSHOT_ID,
    createdAt: "2026-11-10T12:10:00Z",
    keyEnvelopes: [passwordEnvelope, recoveryEnvelope],
    records: [],
    attachments: [],
  });

  // 1. Bit flip in ciphertext -> rejects ciphertext digest mismatch before decrypt
  const tamperedCiphertext = {
    ...pkg,
    ciphertext: pkg.ciphertext.slice(0, -4) + "AAAA",
  };
  await assert.rejects(
    () => openBackupPackage(tamperedCiphertext, vek),
    /ciphertext digest mismatch/i,
  );

  // 2. Ciphertext length mismatch -> rejects size mismatch
  const tamperedSize = {
    ...pkg,
    ciphertextSize: pkg.ciphertextSize + 1,
  };
  await assert.rejects(
    () => openBackupPackage(tamperedSize, vek),
    /size mismatch/i,
  );

  // 3. Bit flip in salt -> rejects decryption failure
  const tamperedSalt = {
    ...pkg,
    salt: "AAAAAAAAAAAAAAAAAAAAAA",
  };
  await assert.rejects(
    () => openBackupPackage(tamperedSalt, vek),
    /decryption failed/i,
  );

  // 4. Mismatched rootHash in manifestSummary -> rejects root hash mismatch
  const tamperedRoot = {
    ...pkg,
    manifestSummary: {
      ...pkg.manifestSummary,
      rootHash:
        "0000000000000000000000000000000000000000000000000000000000000000",
    },
  };
  await assert.rejects(
    () => openBackupPackage(tamperedRoot, vek),
    /root hash mismatch/i,
  );
});
