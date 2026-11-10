import test from "node:test";
import assert from "node:assert/strict";
import {
  generateAttachmentKey,
  wrapAttachmentKey,
  unwrapAttachmentKey,
  sealAttachmentStream,
  openAttachmentStream,
  importVek,
  STREAM_MAGIC,
} from "../src/index.ts";

const TEST_VAULT_ID = "11111111-1111-4111-8111-111111111111";
const TEST_ATTACHMENT_ID = "22222222-2222-4222-8222-222222222222";

function makeContext(revision = 1, objectId = TEST_ATTACHMENT_ID) {
  return {
    protocolVersion: 1,
    purpose: "attachment",
    vaultId: TEST_VAULT_ID,
    objectId,
    revision,
    payloadVersion: 1,
  };
}

test("attachment key wrapping and unwrapping roundtrip with VEK", async () => {
  const rawVek = crypto.getRandomValues(new Uint8Array(32));
  const vek = await importVek(rawVek);
  const context = makeContext();

  const streamKey = await generateAttachmentKey();
  assert.equal(streamKey.length, 32);

  const wrappedKey = await wrapAttachmentKey(vek, context, streamKey);
  assert.equal(typeof wrappedKey, "string");

  const unwrappedKey = await unwrapAttachmentKey(vek, context, wrappedKey);
  assert.deepEqual(unwrappedKey, streamKey);

  // Mismatched context rejects unwrapping
  const wrongContext = {
    ...context,
    objectId: "33333333-3333-4333-8333-333333333333",
  };
  await assert.rejects(
    () => unwrapAttachmentKey(vek, wrongContext, wrappedKey),
    /OperationError|unwrapKey/,
  );
});

test("empty attachment encryption and decryption roundtrip", async () => {
  const streamKey = await generateAttachmentKey();
  const context = makeContext();
  const emptyPlaintext = new Uint8Array(0);

  const ciphertext = await sealAttachmentStream(
    streamKey,
    context,
    emptyPlaintext,
  );
  assert(ciphertext.length > 34); // Magic (8) + version (2) + header (24) + frame (4 + 17) = 55 bytes
  assert.deepEqual(ciphertext.subarray(0, 8), STREAM_MAGIC);

  const decrypted = await openAttachmentStream(streamKey, context, ciphertext);
  assert.equal(decrypted.length, 0);
});

test("small payload (< 1 MiB) attachment streaming roundtrip", async () => {
  const streamKey = await generateAttachmentKey();
  const context = makeContext();
  const plaintext = new TextEncoder().encode(
    "The quick brown fox jumps over the lazy dog. Confidential PDV document.",
  );

  const ciphertext = await sealAttachmentStream(streamKey, context, plaintext);
  const decrypted = await openAttachmentStream(streamKey, context, ciphertext);
  assert.deepEqual(decrypted, plaintext);
});

test("multi-chunk payload (> 1 MiB) attachment streaming roundtrip", async () => {
  const streamKey = await generateAttachmentKey();
  const context = makeContext();
  // 1.5 MiB payload to test multi-frame streaming
  const size = 1.5 * 1024 * 1024;
  const plaintext = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    plaintext[i] = i % 251;
  }

  const ciphertext = await sealAttachmentStream(streamKey, context, plaintext);
  const decrypted = await openAttachmentStream(streamKey, context, ciphertext);
  assert.equal(decrypted.length, plaintext.length);
  assert.deepEqual(decrypted, plaintext);
});

test("context mismatch rejects attachment stream decryption", async () => {
  const streamKey = await generateAttachmentKey();
  const context = makeContext(1);
  const plaintext = new TextEncoder().encode("Secret contract payload");

  const ciphertext = await sealAttachmentStream(streamKey, context, plaintext);

  // Wrong revision in context
  const wrongRevContext = makeContext(2);
  await assert.rejects(
    () => openAttachmentStream(streamKey, wrongRevContext, ciphertext),
    /Attachment frame authentication failed/,
  );

  // Wrong vault in context
  const wrongVaultContext = {
    ...context,
    vaultId: "99999999-9999-4999-8999-999999999999",
  };
  await assert.rejects(
    () => openAttachmentStream(streamKey, wrongVaultContext, ciphertext),
    /Attachment frame authentication failed/,
  );
});

test("tampered frame ciphertext is rejected", async () => {
  const streamKey = await generateAttachmentKey();
  const context = makeContext();
  const plaintext = new TextEncoder().encode("Authentic unmodified payload");

  const ciphertext = await sealAttachmentStream(streamKey, context, plaintext);
  const tampered = new Uint8Array(ciphertext);
  // Corrupt last byte
  tampered[tampered.length - 1] ^= 0x42;

  await assert.rejects(
    () => openAttachmentStream(streamKey, context, tampered),
    /Attachment frame authentication failed/,
  );
});

test("truncated stream is rejected when final frame is missing", async () => {
  const streamKey = await generateAttachmentKey();
  const context = makeContext();
  const plaintext = new TextEncoder().encode("Payload to be truncated");

  const ciphertext = await sealAttachmentStream(streamKey, context, plaintext);
  // Truncate last 10 bytes
  const truncated = ciphertext.subarray(0, ciphertext.length - 10);

  await assert.rejects(
    () => openAttachmentStream(streamKey, context, truncated),
    /Attachment stream truncated/,
  );
});
