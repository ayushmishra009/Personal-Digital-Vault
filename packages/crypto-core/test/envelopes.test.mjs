import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createVekEnvelopes,
  decodeRecoverySecret,
  derivePasswordKek,
  encodeContext,
  importVek,
  openObject,
  rewrapVekWithPassword,
  sealObject,
  unwrapVekWithPassword,
  unwrapVekWithRecovery,
} from "../src/index.ts";
import { WorkerArgon2idProvider } from "../src/argon2-worker-provider.ts";
import {
  CreateVaultRequestSchema,
  NewVaultKeyEnvelopeSchema,
  VaultKeyEnvelopeSchema,
} from "../../validation/src/index.ts";

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
const p1 = { version: 19, memoryKiB: 65_536, iterations: 3, parallelism: 1 };
const p4 = { version: 19, memoryKiB: 65_536, iterations: 3, parallelism: 4 };
const p4Hex =
  "b8a64b68dea6b88ca8c8862be706aac37cbecda0db7bd68b48f8fa2e7feb6f3e";
const p1Hex =
  "daf16780dcb73e862146297fa17b81b86b480f33c0b67daef0f2c7c809c5797b";

const provider = {
  async deriveKey(password, salt, parameters) {
    assert.deepEqual(
      parameters,
      p1.parallelism === parameters.parallelism ? p1 : p4,
    );
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

function deterministicCrypto() {
  let next = 0;
  return {
    subtle: webcrypto.subtle,
    getRandomValues(array) {
      for (let index = 0; index < array.length; index += 1)
        array[index] = next++ & 0xff;
      return array;
    },
  };
}

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

test("Argon2id p=4 exact-tuple KAT and UTF-8 input bytes", async () => {
  let observed;
  const capture = {
    async deriveKey(password, salt, parameters) {
      observed = {
        password: Buffer.from(password).toString("hex"),
        salt: Buffer.from(salt).toString(),
        parameters,
      };
      return provider.deriveKey(password, salt, parameters);
    },
  };
  const output = await capture.deriveKey(
    new TextEncoder().encode("password"),
    new TextEncoder().encode("0123456789abcdef"),
    p4,
  );
  assert.equal(hex(output), p4Hex);
  assert.deepEqual(observed, {
    password: "70617373776f7264",
    salt: "0123456789abcdef",
    parameters: p4,
  });
});

test("PDV context encoding matches the candidate vector and rejects invalid fields", () => {
  const context = {
    protocolVersion: 1,
    purpose: "record",
    vaultId: "00112233-4455-6677-8899-aabbccddeeff",
    objectId: "10213243-5465-7687-98a9-bacbdcedfe0f",
    revision: 3,
    payloadVersion: 1,
  };
  assert.equal(
    hex(encodeContext(context)),
    "504456000001067265636f726400112233445566778899aabbccddeeff102132435465768798a9bacbdcedfe0f000000000000000300000001",
  );
  assert.throws(
    () => encodeContext({ ...context, protocolVersion: 2 }),
    /Unsupported protocol version/,
  );
  assert.throws(
    () => encodeContext({ ...context, purpose: "RécOrd" }),
    /Invalid purpose/,
  );
  assert.throws(
    () => encodeContext({ ...context, vaultId: "not-a-uuid" }),
    /Invalid UUID/,
  );
  assert.throws(
    () => encodeContext({ ...context, revision: 0 }),
    /must be positive/,
  );
  assert.throws(
    () => encodeContext({ ...context, revision: Number.MAX_SAFE_INTEGER + 1 }),
    /Invalid revision/,
  );
  assert.throws(
    () => encodeContext({ ...context, payloadVersion: 0 }),
    /must be positive/,
  );
});

test("creation emits p=4 only; password and independent recovery unlock", async () => {
  const created = await createVekEnvelopes(
    "päss🔐",
    provider,
    deterministicCrypto(),
  );
  assert.deepEqual(created.passwordEnvelope, {
    protocolVersion: 1,
    envelopeType: "password",
    keyWrapAlgorithm: "AES-256-KW",
    kdfAlgorithm: "argon2id13",
    kdfParameters: p4,
    salt: "QEFCQ0RFRkdISUpLTE1OTw",
    wrappedVek: "-sUnFpAk4ctosqxzWFCAzvqAe3nBr6o8WwQKdBCwuVKRSZjzgEVltQ",
  });
  assert.deepEqual(created.recoveryEnvelope, {
    protocolVersion: 1,
    envelopeType: "recovery",
    keyWrapAlgorithm: "AES-256-KW",
    kdfAlgorithm: "hkdf-sha256",
    kdfParameters: {},
    salt: "UFFSU1RVVldYWVpbXF1eXw",
    wrappedVek: "s2HTi-7e7OCBDzaXUY4HlrE4gZQDpRDLfgFUaaRK_IR3qfTb87NyHg",
  });
  assert.deepEqual(created.passwordEnvelope.kdfParameters, p4);
  assert.equal(created.passwordEnvelope.kdfAlgorithm, "argon2id13");
  const passwordUnlocked = await unwrapVekWithPassword(
    "päss🔐",
    created.passwordEnvelope,
    provider,
    webcrypto,
  );
  const recoveryUnlocked = await unwrapVekWithRecovery(
    created.recoverySecret,
    created.recoveryEnvelope,
    webcrypto,
  );
  const payload = { title: "synthetic unicode 🔐", n: 1 };
  const object = await sealObject(
    created.vek,
    {
      protocolVersion: 1,
      purpose: "record",
      vaultId: "00112233-4455-6677-8899-aabbccddeeff",
      objectId: "10213243-5465-7687-98a9-bacbdcedfe0f",
      revision: 1,
      payloadVersion: 1,
    },
    payload,
    webcrypto,
  );
  assert.deepEqual(
    await openObject(passwordUnlocked, object, webcrypto),
    payload,
  );
  assert.deepEqual(
    await openObject(recoveryUnlocked, object, webcrypto),
    payload,
  );
  await assert.rejects(
    unwrapVekWithPassword(
      "wrong",
      created.passwordEnvelope,
      provider,
      webcrypto,
    ),
  );
  const recoveryCopy = decodeRecoverySecret(
    created.recoverySecret instanceof Uint8Array
      ? Buffer.from(created.recoverySecret).toString("base64url")
      : created.recoverySecret,
  );
  assert.deepEqual(recoveryCopy, created.recoverySecret);
});

test("object envelopes reject tampering and cross-context substitution", async () => {
  const created = await createVekEnvelopes(
    "synthetic-password",
    provider,
    deterministicCrypto(),
  );
  const context = {
    protocolVersion: 1,
    purpose: "record",
    vaultId: "00112233-4455-6677-8899-aabbccddeeff",
    objectId: "10213243-5465-7687-98a9-bacbdcedfe0f",
    revision: 3,
    payloadVersion: 1,
  };
  const envelope = await sealObject(
    created.vek,
    context,
    { synthetic: true },
    webcrypto,
  );
  const changedContexts = [
    { ...envelope, vaultId: "10112233-4455-6677-8899-aabbccddeeff" },
    { ...envelope, objectId: "20213243-5465-7687-98a9-bacbdcedfe0f" },
    { ...envelope, revision: 4 },
    { ...envelope, payloadVersion: 2 },
    { ...envelope, purpose: "attachment" },
  ];
  for (const changed of changedContexts) {
    await assert.rejects(openObject(created.vek, changed, webcrypto), {
      message: "Invalid ciphertext",
    });
  }

  const otherVek = await importVek(
    Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    webcrypto,
  );
  await assert.rejects(openObject(otherVek, envelope, webcrypto), {
    message: "Invalid ciphertext",
  });

  for (const field of ["nonce", "wrappedDek", "ciphertext"]) {
    const bytes = Buffer.from(envelope[field], "base64url");
    bytes[field === "ciphertext" ? bytes.length - 1 : 0] ^= 1;
    await assert.rejects(
      openObject(
        created.vek,
        { ...envelope, [field]: bytes.toString("base64url") },
        webcrypto,
      ),
      { message: "Invalid ciphertext" },
    );
  }
  const damagedCiphertext = Buffer.from(envelope.ciphertext, "base64url");
  damagedCiphertext[0] ^= 1;
  await assert.rejects(
    openObject(
      created.vek,
      { ...envelope, ciphertext: damagedCiphertext.toString("base64url") },
      webcrypto,
    ),
    { message: "Invalid ciphertext" },
  );
  await assert.rejects(
    openObject(created.vek, { ...envelope, nonce: "AA===" }, webcrypto),
    /Invalid base64url/,
  );
  await assert.rejects(
    openObject(created.vek, { ...envelope, nonce: "AB" }, webcrypto),
    /Noncanonical base64url/,
  );
  await assert.rejects(
    openObject(
      created.vek,
      { ...envelope, nonce: Buffer.alloc(11).toString("base64url") },
      webcrypto,
    ),
    /Invalid nonce length/,
  );
  await assert.rejects(
    openObject(
      created.vek,
      { ...envelope, ciphertext: Buffer.alloc(15).toString("base64url") },
      webcrypto,
    ),
    /Invalid ciphertext/,
  );
  await assert.rejects(
    openObject(
      created.vek,
      { ...envelope, algorithm: "AES-128-GCM" },
      webcrypto,
    ),
    /Unsupported envelope/,
  );
  await assert.rejects(
    openObject(created.vek, { ...envelope, protocolVersion: 2 }, webcrypto),
    /Unsupported protocol version/,
  );
});

test("legacy p=1 envelope remains unlockable", async () => {
  const salt = new TextEncoder().encode("0123456789abcdef");
  const rawVek = Uint8Array.from({ length: 32 }, (_, index) => index);
  const kek = await derivePasswordKek(
    "password",
    salt,
    p1,
    provider,
    webcrypto,
  );
  const extractableVek = await webcrypto.subtle.importKey(
    "raw",
    rawVek,
    "AES-KW",
    true,
    ["wrapKey", "unwrapKey"],
  );
  const wrapped = await webcrypto.subtle.wrapKey(
    "raw",
    extractableVek,
    kek,
    "AES-KW",
  );
  const envelope = {
    protocolVersion: 1,
    envelopeType: "password",
    keyWrapAlgorithm: "AES-256-KW",
    kdfAlgorithm: "argon2id13",
    kdfParameters: p1,
    salt: Buffer.from(salt).toString("base64url"),
    wrappedVek: Buffer.from(wrapped).toString("base64url"),
  };
  const unlocked = await unwrapVekWithPassword(
    "password",
    envelope,
    provider,
    webcrypto,
  );
  const object = await sealObject(
    unlocked,
    {
      protocolVersion: 1,
      purpose: "record",
      vaultId: "00112233-4455-6677-8899-aabbccddeeff",
      objectId: "10213243-5465-7687-98a9-bacbdcedfe0f",
      revision: 1,
      payloadVersion: 1,
    },
    { ok: true },
    webcrypto,
  );
  const originalObject = JSON.stringify(object);
  assert.deepEqual(await openObject(unlocked, object, webcrypto), { ok: true });
  assert.equal(p1Hex.length, 64);
  const migrated = await rewrapVekWithPassword(
    "password",
    envelope,
    "migrated-password",
    provider,
    deterministicCrypto(),
  );
  assert.deepEqual(migrated.passwordEnvelope.kdfParameters, p4);
  assert.deepEqual(await openObject(migrated.vek, object, webcrypto), {
    ok: true,
  });
  assert.equal(JSON.stringify(object), originalObject);
  assert.deepEqual(
    await openObject(
      await unwrapVekWithPassword(
        "migrated-password",
        migrated.passwordEnvelope,
        provider,
        webcrypto,
      ),
      object,
      webcrypto,
    ),
    { ok: true },
  );
});

test("password change rewraps the same VEK and preserves recovery envelope and payload", async () => {
  const created = await createVekEnvelopes(
    "old-password",
    provider,
    deterministicCrypto(),
  );
  const originalRecoveryEnvelope = JSON.stringify(created.recoveryEnvelope);
  const context = {
    protocolVersion: 1,
    purpose: "record",
    vaultId: "00112233-4455-6677-8899-aabbccddeeff",
    objectId: "10213243-5465-7687-98a9-bacbdcedfe0f",
    revision: 1,
    payloadVersion: 1,
  };
  const payload = { secret: "synthetic payload" };
  const encryptedPayload = await sealObject(
    created.vek,
    context,
    payload,
    webcrypto,
  );
  const originalPayloadEnvelope = JSON.stringify(encryptedPayload);
  const changed = await rewrapVekWithPassword(
    "old-password",
    created.passwordEnvelope,
    "new-password",
    provider,
    deterministicCrypto(),
  );
  assert.deepEqual(
    await openObject(changed.vek, encryptedPayload, webcrypto),
    payload,
  );
  assert.equal(JSON.stringify(encryptedPayload), originalPayloadEnvelope);
  assert.deepEqual(
    await openObject(
      await unwrapVekWithPassword(
        "new-password",
        changed.passwordEnvelope,
        provider,
        webcrypto,
      ),
      encryptedPayload,
      webcrypto,
    ),
    payload,
  );
  await assert.rejects(
    unwrapVekWithPassword(
      "old-password",
      changed.passwordEnvelope,
      provider,
      webcrypto,
    ),
  );
  const recovered = await unwrapVekWithRecovery(
    created.recoverySecret,
    created.recoveryEnvelope,
    webcrypto,
  );
  assert.deepEqual(
    await openObject(recovered, encryptedPayload, webcrypto),
    payload,
  );
  await assert.rejects(
    unwrapVekWithRecovery(
      new Uint8Array(32),
      created.recoveryEnvelope,
      webcrypto,
    ),
  );
  assert.deepEqual(changed.passwordEnvelope.kdfParameters, p4);
  assert.equal(
    JSON.stringify(created.recoveryEnvelope),
    originalRecoveryEnvelope,
  );
  assert.equal(created.recoveryEnvelope.kdfAlgorithm, "hkdf-sha256");
  assert.deepEqual(created.recoveryEnvelope.kdfParameters, {});
  assert.equal(encryptedPayload.ciphertext.length > 0, true);
});

test("Unicode passwords are UTF-8 without normalization and malformed surrogates reject", async () => {
  const acuteComposed = "é";
  const acuteDecomposed = "e\u0301";
  assert.notEqual(
    hex(new TextEncoder().encode(acuteComposed)),
    hex(new TextEncoder().encode(acuteDecomposed)),
  );
  assert.notEqual(
    hex(
      await provider.deriveKey(
        new TextEncoder().encode(acuteComposed),
        new TextEncoder().encode("0123456789abcdef"),
        p4,
      ),
    ),
    hex(
      await provider.deriveKey(
        new TextEncoder().encode(acuteDecomposed),
        new TextEncoder().encode("0123456789abcdef"),
        p4,
      ),
    ),
  );
  assert.equal(
    Buffer.from(new TextEncoder().encode(" password ")).toString("hex"),
    "2070617373776f726420",
  );
  assert.notEqual(
    hex(
      await provider.deriveKey(
        new TextEncoder().encode(" password "),
        new TextEncoder().encode("0123456789abcdef"),
        p4,
      ),
    ),
    hex(
      await provider.deriveKey(
        new TextEncoder().encode("password"),
        new TextEncoder().encode("0123456789abcdef"),
        p4,
      ),
    ),
  );
  await assert.rejects(
    derivePasswordKek("\ud800", new Uint8Array(16), p4, provider, webcrypto),
    /Unicode/,
  );
});

test("strict KDF tuple validation accepts only p=1 legacy and p=4 proposed", async () => {
  for (const parameters of [p1, p4]) {
    const envelope = {
      protocolVersion: 1,
      envelopeType: "password",
      keyWrapAlgorithm: "AES-256-KW",
      kdfAlgorithm: "argon2id13",
      kdfParameters: parameters,
      salt: "MDEyMzQ1Njc4OWFiY2RlZg",
      wrappedVek: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    };
    assert.equal(VaultKeyEnvelopeSchema.safeParse(envelope).success, true);
    assert.equal(
      NewVaultKeyEnvelopeSchema.safeParse(envelope).success,
      parameters.parallelism === 4,
    );
  }
  const unsupported = { ...p4, parallelism: 2 };
  await assert.rejects(
    derivePasswordKek(
      "password",
      new Uint8Array(16),
      unsupported,
      provider,
      webcrypto,
    ),
  );
  const malformed = {
    envelopeType: "password",
    protocolVersion: 1,
    keyWrapAlgorithm: "AES-256-KW",
    kdfAlgorithm: "argon2id13",
    kdfParameters: { ...p4, extra: 1 },
    salt: "MDEyMzQ1Njc4OWFiY2RlZg",
    wrappedVek: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
  assert.equal(VaultKeyEnvelopeSchema.safeParse(malformed).success, false);
  const passwordEnvelope = {
    envelopeType: "password",
    protocolVersion: 1,
    keyWrapAlgorithm: "AES-256-KW",
    kdfAlgorithm: "argon2id13",
    kdfParameters: p4,
    salt: "MDEyMzQ1Njc4OWFiY2RlZg",
    wrappedVek: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
  const recoveryEnvelope = {
    envelopeType: "recovery",
    protocolVersion: 1,
    keyWrapAlgorithm: "AES-256-KW",
    kdfAlgorithm: "hkdf-sha256",
    kdfParameters: {},
    salt: "MDEyMzQ1Njc4OWFiY2RlZg",
    wrappedVek: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
  assert.equal(
    CreateVaultRequestSchema.safeParse({
      protocolVersion: 1,
      envelopes: [passwordEnvelope, recoveryEnvelope],
    }).success,
    true,
  );
  assert.equal(
    CreateVaultRequestSchema.safeParse({
      protocolVersion: 1,
      envelopes: [{ ...passwordEnvelope, kdfParameters: p1 }, recoveryEnvelope],
    }).success,
    false,
  );
  await assert.rejects(
    derivePasswordKek(
      "password",
      new Uint8Array(16),
      p4,
      {
        async deriveKey() {
          return new Uint8Array(31);
        },
      },
      webcrypto,
    ),
    /output length/,
  );
  await assert.rejects(
    derivePasswordKek(
      "password",
      new Uint8Array(16),
      p4,
      {
        async deriveKey() {
          throw new Error("candidate failed");
        },
      },
      webcrypto,
    ),
    /candidate failed/,
  );
});

test("Worker provider terminates on success, cancellation, and worker errors", async () => {
  class FakeWorker {
    onmessage = null;
    onerror = null;
    onmessageerror = null;
    terminated = false;
    postMessage() {
      setTimeout(
        () =>
          this.onmessage?.({
            data: { type: "result", result: new Uint8Array(32).buffer },
          }),
        0,
      );
    }
    terminate() {
      this.terminated = true;
    }
  }
  const worker = new FakeWorker();
  const workerProvider = new WorkerArgon2idProvider(module, () => worker);
  assert.equal(
    (
      await workerProvider.deriveKey(
        new Uint8Array([1]),
        new Uint8Array(16),
        p4,
      )
    ).length,
    32,
  );
  assert.equal(worker.terminated, true);

  const pendingWorker = new FakeWorker();
  pendingWorker.postMessage = () => {};
  const pendingProvider = new WorkerArgon2idProvider(
    module,
    () => pendingWorker,
  );
  const controller = new AbortController();
  const pending = pendingProvider.deriveKey(
    new Uint8Array([1]),
    new Uint8Array(16),
    p4,
    controller.signal,
  );
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(pendingWorker.terminated, true);

  const failedWorker = new FakeWorker();
  failedWorker.postMessage = () =>
    setTimeout(() => failedWorker.onerror?.({ preventDefault() {} }), 0);
  const failedProvider = new WorkerArgon2idProvider(module, () => failedWorker);
  await assert.rejects(
    failedProvider.deriveKey(new Uint8Array([1]), new Uint8Array(16), p4),
    /worker execution failed/,
  );
  assert.equal(failedWorker.terminated, true);
  const startupFailure = new WorkerArgon2idProvider(module, () => {
    throw new Error("blocked");
  });
  await assert.rejects(
    startupFailure.deriveKey(new Uint8Array([1]), new Uint8Array(16), p4),
    /Unable to start/,
  );
  const stalledWorker = new FakeWorker();
  stalledWorker.postMessage = () => {};
  const stalledProvider = new WorkerArgon2idProvider(
    module,
    () => stalledWorker,
    5,
  );
  await assert.rejects(
    stalledProvider.deriveKey(new Uint8Array([1]), new Uint8Array(16), p4),
    /timed out/,
  );
  assert.equal(stalledWorker.terminated, true);
});
