/**
 * PDV cryptographic protocol prototype.
 *
 * This package is not audited and must not be used with real vault data.
 * Password Argon2id is intentionally behind a provider boundary until the
 * required maintained browser-WASM implementation is selected and reviewed.
 */

import _sodium from "libsodium-wrappers";

const PROTOCOL_VERSION = 1;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BITS = 128;
const AES_KEY_BYTES = 32;
const AES_KW_WRAPPED_KEY_BYTES = 40;
const ARGON2ID_VERSION = 19 as const;
const ARGON2ID_MEMORY_KIB = 65_536;
const ARGON2ID_ITERATIONS = 3;
const ARGON2ID_LEGACY_PARALLELISM = 1;
const ARGON2ID_CURRENT_PARALLELISM = 4;
const PURPOSE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const UTF8 = new TextEncoder();

export type ObjectContext = Readonly<{
  protocolVersion: number;
  purpose: string;
  vaultId: string;
  objectId: string;
  revision: number;
  payloadVersion: number;
}>;

export type ObjectEnvelope = Readonly<{
  protocolVersion: 1;
  algorithm: "AES-256-GCM";
  keyWrapAlgorithm: "AES-256-KW";
  vaultId: string;
  objectId: string;
  revision: number;
  payloadVersion: number;
  purpose: string;
  nonce: string;
  wrappedDek: string;
  ciphertext: string;
}>;

export type VekEnvelope = Readonly<{
  protocolVersion: 1;
  envelopeType: "password" | "recovery";
  keyWrapAlgorithm: "AES-256-KW";
  kdfAlgorithm: "argon2id13" | "hkdf-sha256";
  kdfParameters: Readonly<Record<string, number>>;
  salt: string;
  wrappedVek: string;
}>;

export type Argon2idParameters = Readonly<{
  version: 19;
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}>;

const CURRENT_ARGON2ID_PARAMETERS: Argon2idParameters = Object.freeze({
  version: ARGON2ID_VERSION,
  memoryKiB: ARGON2ID_MEMORY_KIB,
  iterations: ARGON2ID_ITERATIONS,
  parallelism: ARGON2ID_CURRENT_PARALLELISM,
});

/** Adapter contract; do not implement with a different KDF silently. */
export interface Argon2idProvider {
  deriveKey(
    passwordUtf8: Uint8Array,
    salt: Uint8Array,
    parameters: Argon2idParameters,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
}

/** Encode the protocol's fixed binary context. */
export function encodeContext(context: ObjectContext): Uint8Array {
  if (context.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error("Unsupported protocol version");
  }
  if (!PURPOSE_PATTERN.test(context.purpose)) {
    throw new Error("Invalid purpose");
  }
  const vaultId = parseUuid(context.vaultId);
  const objectId = parseUuid(context.objectId);
  assertUint(context.revision, 64, "revision");
  assertUint(context.payloadVersion, 32, "payload version");
  if (context.revision === 0 || context.payloadVersion === 0) {
    throw new Error("Revision and payload version must be positive");
  }

  const purpose = UTF8.encode(context.purpose);
  const bytes = new Uint8Array(4 + 2 + 1 + purpose.length + 16 + 16 + 8 + 4);
  let offset = 0;
  bytes.set([0x50, 0x44, 0x56, 0x00], offset);
  offset += 4;
  writeUint(bytes, offset, context.protocolVersion, 2);
  offset += 2;
  bytes[offset++] = purpose.length;
  bytes.set(purpose, offset);
  offset += purpose.length;
  bytes.set(vaultId, offset);
  offset += 16;
  bytes.set(objectId, offset);
  offset += 16;
  writeUint(bytes, offset, context.revision, 8);
  offset += 8;
  writeUint(bytes, offset, context.payloadVersion, 4);
  return bytes;
}

/** RFC 8785-compatible canonical JSON for JSON values used as payloads. */
export function canonicalizeJson(value: unknown): Uint8Array {
  return UTF8.encode(canonicalJsonValue(value, new Set<object>()));
}

/** Import random VEK material as a non-extractable runtime key. */
export async function importVek(
  rawVek: Uint8Array,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<CryptoKey> {
  assertLength(rawVek, AES_KEY_BYTES, "VEK");
  const material = copyBuffer(rawVek);
  try {
    return await cryptoProvider.subtle.importKey(
      "raw",
      material,
      { name: "HKDF" },
      false,
      ["deriveKey"],
    );
  } finally {
    new Uint8Array(material).fill(0);
  }
}

/**
 * Seal one JSON object revision. A fresh DEK and nonce are created for every
 * call. The plaintext object and all temporary key material remain client-side.
 */
export async function sealObject(
  vek: CryptoKey,
  context: ObjectContext,
  payload: unknown,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<ObjectEnvelope> {
  const aad = encodeContext(context);
  const nonce = cryptoProvider.getRandomValues(
    new Uint8Array(AES_GCM_NONCE_BYTES),
  );
  const dek = await cryptoProvider.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const wrappingKey = await deriveObjectWrappingKey(
    vek,
    context,
    cryptoProvider,
  );
  const plaintext = canonicalizeJson(payload);
  const plaintextBuffer = copyBuffer(plaintext);
  try {
    const [ciphertext, wrappedDek] = await Promise.all([
      cryptoProvider.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: copyBuffer(nonce),
          additionalData: copyBuffer(aad),
          tagLength: AES_GCM_TAG_BITS,
        },
        dek,
        plaintextBuffer,
      ),
      cryptoProvider.subtle.wrapKey("raw", dek, wrappingKey, "AES-KW"),
    ]);
    return {
      protocolVersion: 1,
      algorithm: "AES-256-GCM",
      keyWrapAlgorithm: "AES-256-KW",
      vaultId: context.vaultId,
      objectId: context.objectId,
      revision: context.revision,
      payloadVersion: context.payloadVersion,
      purpose: context.purpose,
      nonce: encodeBase64Url(nonce),
      wrappedDek: encodeBase64Url(new Uint8Array(wrappedDek)),
      ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
    };
  } finally {
    plaintext.fill(0);
    new Uint8Array(plaintextBuffer).fill(0);
  }
}

/** Authenticate and decrypt an object envelope; no plaintext is returned on failure. */
export async function openObject(
  vek: CryptoKey,
  envelope: ObjectEnvelope,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<unknown> {
  const context: ObjectContext = {
    protocolVersion: envelope.protocolVersion,
    purpose: envelope.purpose,
    vaultId: envelope.vaultId,
    objectId: envelope.objectId,
    revision: envelope.revision,
    payloadVersion: envelope.payloadVersion,
  };
  const aad = encodeContext(context);
  const nonce = decodeBase64Url(envelope.nonce);
  const wrappedDek = decodeBase64Url(envelope.wrappedDek);
  const ciphertext = decodeBase64Url(envelope.ciphertext);
  assertLength(nonce, AES_GCM_NONCE_BYTES, "nonce");
  assertLength(wrappedDek, AES_KW_WRAPPED_KEY_BYTES, "wrapped DEK");
  if (ciphertext.length < AES_GCM_TAG_BITS / 8) {
    throw new Error("Invalid ciphertext");
  }
  if (
    envelope.algorithm !== "AES-256-GCM" ||
    envelope.keyWrapAlgorithm !== "AES-256-KW" ||
    envelope.protocolVersion !== PROTOCOL_VERSION
  ) {
    throw new Error("Unsupported envelope");
  }

  let plaintext: Uint8Array | undefined;
  try {
    const wrappingKey = await deriveObjectWrappingKey(
      vek,
      context,
      cryptoProvider,
    );
    const dek = await cryptoProvider.subtle.unwrapKey(
      "raw",
      copyBuffer(wrappedDek),
      wrappingKey,
      "AES-KW",
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const result = await cryptoProvider.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: copyBuffer(nonce),
        additionalData: copyBuffer(aad),
        tagLength: AES_GCM_TAG_BITS,
      },
      dek,
      copyBuffer(ciphertext),
    );
    plaintext = new Uint8Array(result);
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
    ) as unknown;
  } catch {
    throw new Error("Invalid ciphertext");
  } finally {
    plaintext?.fill(0);
  }
}

/** Derive a password wrapping key. KDF behavior is supplied by a reviewed adapter. */
export async function derivePasswordKek(
  password: string,
  salt: Uint8Array,
  parameters: Argon2idParameters,
  provider: Argon2idProvider,
  cryptoProvider: Crypto = globalThis.crypto,
  signal?: AbortSignal,
): Promise<CryptoKey> {
  assertLength(salt, 16, "Argon2id salt");
  validateArgon2idParameters(parameters);
  if (!isWellFormed(password)) throw new Error("Invalid password Unicode");
  const passwordBytes = UTF8.encode(password);
  let derived: Uint8Array | undefined;
  let derivedBuffer: ArrayBuffer | undefined;
  try {
    derived = await provider.deriveKey(passwordBytes, salt, parameters, signal);
    assertLength(derived, AES_KEY_BYTES, "Argon2id output");
    derivedBuffer = copyBuffer(derived);
    return await cryptoProvider.subtle.importKey(
      "raw",
      derivedBuffer,
      { name: "AES-KW" },
      false,
      ["wrapKey", "unwrapKey"],
    );
  } finally {
    passwordBytes.fill(0);
    derived?.fill(0);
    if (derivedBuffer) new Uint8Array(derivedBuffer).fill(0);
  }
}

/** Derive the independent recovery KEK from a 256-bit recovery secret. */
export async function deriveRecoveryKek(
  recoverySecret: Uint8Array,
  salt: Uint8Array,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<CryptoKey> {
  assertLength(recoverySecret, AES_KEY_BYTES, "recovery secret");
  assertLength(salt, 16, "recovery salt");
  const secretCopy = copyBuffer(recoverySecret);
  let material: CryptoKey;
  try {
    material = await cryptoProvider.subtle.importKey(
      "raw",
      secretCopy,
      "HKDF",
      false,
      ["deriveKey"],
    );
  } finally {
    new Uint8Array(secretCopy).fill(0);
  }
  return cryptoProvider.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: copyBuffer(salt),
      info: copyBuffer(UTF8.encode("PDV/1/recovery-vek-wrap")),
    },
    material,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/** Unlock with a password using only the Argon2id provider's accepted tuple. */
export async function unwrapVekWithPassword(
  password: string,
  envelope: VekEnvelope,
  provider: Argon2idProvider,
  cryptoProvider: Crypto = globalThis.crypto,
  signal?: AbortSignal,
): Promise<CryptoKey> {
  const parameters = readArgon2idParameters(envelope);
  const salt = decodeBase64Url(envelope.salt);
  assertLength(salt, 16, "password envelope salt");
  const kek = await derivePasswordKek(
    password,
    salt,
    parameters,
    provider,
    cryptoProvider,
    signal,
  );
  return unwrapVek(kek, envelope, "password", cryptoProvider);
}

/** Unlock with a recovery secret; malformed and wrong-key envelopes fail closed. */
export async function unwrapVekWithRecovery(
  recoverySecret: Uint8Array,
  envelope: VekEnvelope,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<CryptoKey> {
  if (
    envelope.kdfAlgorithm !== "hkdf-sha256" ||
    Object.keys(envelope.kdfParameters).length !== 0
  ) {
    throw new Error("Invalid key envelope");
  }
  const salt = decodeBase64Url(envelope.salt);
  assertLength(salt, 16, "recovery envelope salt");
  const kek = await deriveRecoveryKek(recoverySecret, salt, cryptoProvider);
  return unwrapVek(kek, envelope, "recovery", cryptoProvider);
}

/** Generate a 256-bit recovery secret. The caller must present and retain it safely. */
export function generateRecoverySecret(
  cryptoProvider: Crypto = globalThis.crypto,
): Uint8Array {
  return cryptoProvider.getRandomValues(new Uint8Array(AES_KEY_BYTES));
}

export function encodeRecoverySecret(recoverySecret: Uint8Array): string {
  assertLength(recoverySecret, AES_KEY_BYTES, "recovery secret");
  return encodeBase64Url(recoverySecret);
}

export function decodeRecoverySecret(encoded: string): Uint8Array {
  const recoverySecret = decodeBase64Url(encoded);
  assertLength(recoverySecret, AES_KEY_BYTES, "recovery secret");
  return recoverySecret;
}

/** Wrap a freshly generated, extractable VEK for two independent envelopes. */
export async function createVekEnvelopes(
  password: string,
  argon2id: Argon2idProvider,
  cryptoProvider: Crypto = globalThis.crypto,
  signal?: AbortSignal,
): Promise<{
  vek: CryptoKey;
  recoverySecret: Uint8Array;
  passwordEnvelope: VekEnvelope;
  recoveryEnvelope: VekEnvelope;
}> {
  const rawVek = cryptoProvider.getRandomValues(new Uint8Array(AES_KEY_BYTES));
  const recoverySecret = generateRecoverySecret(cryptoProvider);
  const passwordSalt = cryptoProvider.getRandomValues(new Uint8Array(16));
  const recoverySalt = cryptoProvider.getRandomValues(new Uint8Array(16));
  let rawVekBuffer: ArrayBuffer | undefined;
  let succeeded = false;
  try {
    rawVekBuffer = copyBuffer(rawVek);
    const [passwordKek, extractableVek, recoveryKek] = await Promise.all([
      derivePasswordKek(
        password,
        passwordSalt,
        CURRENT_ARGON2ID_PARAMETERS,
        argon2id,
        cryptoProvider,
        signal,
      ),
      cryptoProvider.subtle.importKey(
        "raw",
        rawVekBuffer,
        { name: "AES-KW" },
        true,
        ["wrapKey", "unwrapKey"],
      ),
      deriveRecoveryKek(recoverySecret, recoverySalt, cryptoProvider),
    ]);
    const [passwordWrapped, recoveryWrapped] = await Promise.all([
      cryptoProvider.subtle.wrapKey(
        "raw",
        extractableVek,
        passwordKek,
        "AES-KW",
      ),
      cryptoProvider.subtle.wrapKey(
        "raw",
        extractableVek,
        recoveryKek,
        "AES-KW",
      ),
    ]);
    const vek = await importVek(rawVek, cryptoProvider);
    const result = {
      vek,
      recoverySecret,
      passwordEnvelope: {
        protocolVersion: 1 as const,
        envelopeType: "password" as const,
        keyWrapAlgorithm: "AES-256-KW" as const,
        kdfAlgorithm: "argon2id13" as const,
        kdfParameters: {
          version: CURRENT_ARGON2ID_PARAMETERS.version,
          memoryKiB: CURRENT_ARGON2ID_PARAMETERS.memoryKiB,
          iterations: CURRENT_ARGON2ID_PARAMETERS.iterations,
          parallelism: CURRENT_ARGON2ID_PARAMETERS.parallelism,
        },
        salt: encodeBase64Url(passwordSalt),
        wrappedVek: encodeBase64Url(new Uint8Array(passwordWrapped)),
      },
      recoveryEnvelope: {
        protocolVersion: 1 as const,
        envelopeType: "recovery" as const,
        keyWrapAlgorithm: "AES-256-KW" as const,
        kdfAlgorithm: "hkdf-sha256" as const,
        kdfParameters: {},
        salt: encodeBase64Url(recoverySalt),
        wrappedVek: encodeBase64Url(new Uint8Array(recoveryWrapped)),
      },
    };
    succeeded = true;
    return result;
  } finally {
    if (rawVekBuffer) new Uint8Array(rawVekBuffer).fill(0);
    rawVek.fill(0);
    if (!succeeded) recoverySecret.fill(0);
  }
}

/**
 * Change the password while retaining the exact VEK. The recovery envelope is
 * intentionally left to the caller and remains independent of the password KDF.
 */
export async function rewrapVekWithPassword(
  currentPassword: string,
  currentEnvelope: VekEnvelope,
  newPassword: string,
  provider: Argon2idProvider,
  cryptoProvider: Crypto = globalThis.crypto,
  signal?: AbortSignal,
): Promise<{ vek: CryptoKey; passwordEnvelope: VekEnvelope }> {
  const currentParameters = readArgon2idParameters(currentEnvelope);
  const currentSalt = decodeBase64Url(currentEnvelope.salt);
  assertLength(currentSalt, 16, "password envelope salt");
  const currentKek = await derivePasswordKek(
    currentPassword,
    currentSalt,
    currentParameters,
    provider,
    cryptoProvider,
    signal,
  );
  const extractableVek = await unwrapVek(
    currentKek,
    currentEnvelope,
    "password",
    cryptoProvider,
    true,
  );
  const nextSalt = cryptoProvider.getRandomValues(new Uint8Array(16));
  const nextKek = await derivePasswordKek(
    newPassword,
    nextSalt,
    CURRENT_ARGON2ID_PARAMETERS,
    provider,
    cryptoProvider,
    signal,
  );
  let rawVek: Uint8Array | undefined;
  try {
    rawVek = new Uint8Array(
      await cryptoProvider.subtle.exportKey("raw", extractableVek),
    );
    const wrappedVek = await cryptoProvider.subtle.wrapKey(
      "raw",
      extractableVek,
      nextKek,
      "AES-KW",
    );
    const vek = await importVek(rawVek, cryptoProvider);
    return {
      vek,
      passwordEnvelope: {
        protocolVersion: 1,
        envelopeType: "password",
        keyWrapAlgorithm: "AES-256-KW",
        kdfAlgorithm: "argon2id13",
        kdfParameters: { ...CURRENT_ARGON2ID_PARAMETERS },
        salt: encodeBase64Url(nextSalt),
        wrappedVek: encodeBase64Url(new Uint8Array(wrappedVek)),
      },
    };
  } finally {
    rawVek?.fill(0);
    nextSalt.fill(0);
  }
}

async function unwrapVek(
  kek: CryptoKey,
  envelope: VekEnvelope,
  expectedType: "password" | "recovery",
  cryptoProvider: Crypto,
  extractable = false,
): Promise<CryptoKey> {
  if (
    envelope.protocolVersion !== PROTOCOL_VERSION ||
    envelope.envelopeType !== expectedType ||
    envelope.keyWrapAlgorithm !== "AES-256-KW" ||
    (expectedType === "password" && envelope.kdfAlgorithm !== "argon2id13") ||
    (expectedType === "recovery" && envelope.kdfAlgorithm !== "hkdf-sha256")
  ) {
    throw new Error("Invalid key envelope");
  }
  const wrappedVek = decodeBase64Url(envelope.wrappedVek);
  assertLength(wrappedVek, AES_KW_WRAPPED_KEY_BYTES, "wrapped VEK");
  try {
    const unwrapped = await cryptoProvider.subtle.unwrapKey(
      "raw",
      copyBuffer(wrappedVek),
      kek,
      "AES-KW",
      extractable ? { name: "AES-KW" } : { name: "HKDF" },
      extractable,
      extractable ? ["wrapKey", "unwrapKey"] : ["deriveKey"],
    );
    // The extractable AES-KW key exists only for protocol-defined rewrapping.
    // Operational unlock returns the VEK as a non-extractable HKDF key.
    return unwrapped;
  } catch {
    throw new Error("Unable to unlock vault");
  }
}

function readArgon2idParameters(envelope: VekEnvelope): Argon2idParameters {
  if (
    envelope.protocolVersion !== PROTOCOL_VERSION ||
    envelope.envelopeType !== "password" ||
    envelope.keyWrapAlgorithm !== "AES-256-KW" ||
    envelope.kdfAlgorithm !== "argon2id13"
  ) {
    throw new Error("Invalid key envelope");
  }
  const { version, memoryKiB, iterations, parallelism } =
    envelope.kdfParameters;
  const isExactTuple = (candidateParallelism: number): boolean =>
    Object.keys(envelope.kdfParameters).length === 4 &&
    version === ARGON2ID_VERSION &&
    memoryKiB === ARGON2ID_MEMORY_KIB &&
    iterations === ARGON2ID_ITERATIONS &&
    parallelism === candidateParallelism;
  if (
    !isExactTuple(ARGON2ID_LEGACY_PARALLELISM) &&
    !isExactTuple(ARGON2ID_CURRENT_PARALLELISM)
  ) {
    throw new Error("Unsupported Argon2id parameters");
  }
  return { version: 19, memoryKiB: 65_536, iterations: 3, parallelism };
}

function deriveObjectWrappingKey(
  vek: CryptoKey,
  context: ObjectContext,
  cryptoProvider: Crypto,
): Promise<CryptoKey> {
  const contextBytes = encodeContext(context);
  const infoPrefix = UTF8.encode("PDV/1/object-dek-wrap\u0000");
  const info = new Uint8Array(infoPrefix.length + contextBytes.length);
  info.set(infoPrefix);
  info.set(contextBytes, infoPrefix.length);
  return cryptoProvider.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: copyBuffer(parseUuid(context.vaultId)),
      info: copyBuffer(info),
    },
    vek,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

function canonicalJsonValue(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "string") {
    if (!isWellFormed(value)) throw new TypeError("Invalid Unicode string");
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite JSON number");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object")
    throw new TypeError("Value is not JSON-compatible");
  if (ancestors.has(value)) throw new TypeError("Cyclic JSON value");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        Object.getOwnPropertySymbols(value).length !== 0 ||
        Object.keys(value).length !== value.length
      ) {
        throw new TypeError(
          "Sparse arrays and extra array properties are not supported",
        );
      }
      const items = Array.from({ length: value.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError("Sparse arrays and accessors are not supported");
        }
        return canonicalJsonValue(descriptor.value, ancestors);
      });
      return `[${items.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Only plain JSON objects are supported");
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError("Symbol properties are not JSON-compatible");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    const properties = keys.map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(
          "Accessors and non-enumerable fields are not supported",
        );
      }
      if (!isWellFormed(key))
        throw new TypeError("Invalid Unicode property name");
      return `${JSON.stringify(key)}:${canonicalJsonValue(descriptor.value, ancestors)}`;
    });
    return `{${properties.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function isWellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function parseUuid(value: string): Uint8Array {
  if (!/^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/.test(value)) {
    throw new Error("Invalid UUID");
  }
  const hex = value.replaceAll("-", "");
  return Uint8Array.from({ length: 16 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}

function assertUint(value: number, bits: 32 | 64, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`Invalid ${label}`);
  const max = bits === 32 ? 0xffff_ffff : Number.MAX_SAFE_INTEGER;
  if (value > max) throw new Error(`Invalid ${label}`);
}

function writeUint(
  output: Uint8Array,
  offset: number,
  value: number,
  bytes: number,
): void {
  let remaining = BigInt(value);
  for (let index = bytes - 1; index >= 0; index -= 1) {
    output[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

function validateArgon2idParameters(parameters: Argon2idParameters): void {
  const commonValid =
    parameters.version !== 19 ||
    parameters.memoryKiB !== 65_536 ||
    parameters.iterations !== 3;
  if (
    commonValid ||
    (parameters.parallelism !== ARGON2ID_LEGACY_PARALLELISM &&
      parameters.parallelism !== ARGON2ID_CURRENT_PARALLELISM)
  ) {
    throw new Error(
      "Unsupported Argon2id parameters; only p=1 legacy and p=4 proposed tuples are accepted",
    );
  }
}

function assertLength(
  value: Uint8Array,
  expected: number,
  label: string,
): void {
  if (value.byteLength !== expected) throw new Error(`Invalid ${label} length`);
}

function copyBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/u.test(value)) {
    throw new Error("Invalid base64url");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const decoded = Uint8Array.from(
    atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)),
    (char) => char.charCodeAt(0),
  );
  if (encodeBase64Url(decoded) !== value)
    throw new Error("Noncanonical base64url");
  return decoded;
}

export const STREAM_MAGIC = new Uint8Array([
  0x50, 0x44, 0x56, 0x53, 0x54, 0x52, 0x4d, 0x00,
]); // "PDVSTRM\0"
export const STREAM_PROTOCOL_VERSION = 1;
const STREAM_HEADER_BYTES = 24;
const STREAM_TAG_BYTES = 17;
const MAX_PLAINTEXT_CHUNK_BYTES = 1024 * 1024; // 1 MiB
const MIN_FRAME_CIPHERTEXT_BYTES = 17;
const MAX_FRAME_CIPHERTEXT_BYTES = MAX_PLAINTEXT_CHUNK_BYTES + STREAM_TAG_BYTES; // 1,048,593
const STREAM_FRAME_AD_PREFIX = UTF8.encode("PDV/1/attachment-chunk\u0000");

function encodeStreamFrameAD(
  contextBytes: Uint8Array,
  chunkIndex: bigint,
): Uint8Array {
  const ad = new Uint8Array(
    STREAM_FRAME_AD_PREFIX.length + contextBytes.length + 8,
  );
  ad.set(STREAM_FRAME_AD_PREFIX, 0);
  ad.set(contextBytes, STREAM_FRAME_AD_PREFIX.length);
  const view = new DataView(
    ad.buffer,
    ad.byteOffset + STREAM_FRAME_AD_PREFIX.length + contextBytes.length,
    8,
  );
  view.setBigUint64(0, chunkIndex, false);
  return ad;
}

export async function generateAttachmentKey(): Promise<Uint8Array> {
  await _sodium.ready;
  return Uint8Array.from(
    _sodium.crypto_secretstream_xchacha20poly1305_keygen(),
  );
}

export async function wrapAttachmentKey(
  vek: CryptoKey,
  context: ObjectContext,
  streamKey: Uint8Array,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<string> {
  if (context.purpose !== "attachment") {
    throw new Error('Attachment key context purpose must be "attachment"');
  }
  assertLength(streamKey, AES_KEY_BYTES, "stream key");
  const wrappingKey = await deriveObjectWrappingKey(
    vek,
    context,
    cryptoProvider,
  );
  const keyToWrap = await cryptoProvider.subtle.importKey(
    "raw",
    copyBuffer(streamKey),
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const wrapped = await cryptoProvider.subtle.wrapKey(
    "raw",
    keyToWrap,
    wrappingKey,
    "AES-KW",
  );
  return encodeBase64Url(new Uint8Array(wrapped));
}

export async function unwrapAttachmentKey(
  vek: CryptoKey,
  context: ObjectContext,
  wrappedKey: string,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<Uint8Array> {
  if (context.purpose !== "attachment") {
    throw new Error('Attachment key context purpose must be "attachment"');
  }
  const wrappedBytes = decodeBase64Url(wrappedKey);
  assertLength(
    wrappedBytes,
    AES_KW_WRAPPED_KEY_BYTES,
    "wrapped attachment key",
  );
  const wrappingKey = await deriveObjectWrappingKey(
    vek,
    context,
    cryptoProvider,
  );
  const unwrapped = await cryptoProvider.subtle.unwrapKey(
    "raw",
    copyBuffer(wrappedBytes),
    wrappingKey,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const rawKey = await cryptoProvider.subtle.exportKey("raw", unwrapped);
  return new Uint8Array(rawKey);
}

export async function sealAttachmentStream(
  streamKey: Uint8Array,
  context: ObjectContext,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  if (context.purpose !== "attachment") {
    throw new Error('Attachment context purpose must be "attachment"');
  }
  assertLength(streamKey, 32, "attachment stream key");
  await _sodium.ready;
  const sodium = _sodium;
  const contextBytes = encodeContext(context);

  const init =
    sodium.crypto_secretstream_xchacha20poly1305_init_push(streamKey);
  const state = init.state;
  const header = init.header;

  const chunks: Uint8Array[] = [];
  if (plaintext.length === 0) {
    chunks.push(new Uint8Array(0));
  } else {
    for (
      let offset = 0;
      offset < plaintext.length;
      offset += MAX_PLAINTEXT_CHUNK_BYTES
    ) {
      chunks.push(
        plaintext.subarray(
          offset,
          Math.min(plaintext.length, offset + MAX_PLAINTEXT_CHUNK_BYTES),
        ),
      );
    }
  }

  const frames: Uint8Array[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const isFinal = i === chunks.length - 1;
    const tag = isFinal
      ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
      : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
    const ad = encodeStreamFrameAD(contextBytes, BigInt(i));
    const frameCiphertext = sodium.crypto_secretstream_xchacha20poly1305_push(
      state,
      chunks[i],
      ad,
      tag,
    );
    frames.push(frameCiphertext);
  }

  let totalLength = STREAM_MAGIC.length + 2 + header.length;
  for (const f of frames) {
    totalLength += 4 + f.length;
  }

  const result = new Uint8Array(totalLength);
  let pos = 0;
  result.set(STREAM_MAGIC, pos);
  pos += STREAM_MAGIC.length;

  const versionView = new DataView(result.buffer, result.byteOffset + pos, 2);
  versionView.setUint16(0, STREAM_PROTOCOL_VERSION, false);
  pos += 2;

  result.set(header, pos);
  pos += header.length;

  for (const f of frames) {
    const lenView = new DataView(result.buffer, result.byteOffset + pos, 4);
    lenView.setUint32(0, f.length, false);
    pos += 4;
    result.set(f, pos);
    pos += f.length;
  }

  return result;
}

export async function openAttachmentStream(
  streamKey: Uint8Array,
  context: ObjectContext,
  streamBytes: Uint8Array,
): Promise<Uint8Array> {
  if (context.purpose !== "attachment") {
    throw new Error('Attachment context purpose must be "attachment"');
  }
  assertLength(streamKey, 32, "attachment stream key");
  await _sodium.ready;
  const sodium = _sodium;
  const contextBytes = encodeContext(context);

  const minHeaderLen = STREAM_MAGIC.length + 2 + STREAM_HEADER_BYTES;
  if (streamBytes.length < minHeaderLen + 4 + MIN_FRAME_CIPHERTEXT_BYTES) {
    throw new Error("Attachment stream truncated: incomplete header or frame");
  }

  for (let i = 0; i < STREAM_MAGIC.length; i++) {
    if (streamBytes[i] !== STREAM_MAGIC[i]) {
      throw new Error("Invalid attachment stream magic header");
    }
  }

  const versionView = new DataView(
    streamBytes.buffer,
    streamBytes.byteOffset + STREAM_MAGIC.length,
    2,
  );
  const version = versionView.getUint16(0, false);
  if (version !== STREAM_PROTOCOL_VERSION) {
    throw new Error(`Unsupported attachment stream version: ${version}`);
  }

  const headerOffset = STREAM_MAGIC.length + 2;
  const header = streamBytes.subarray(
    headerOffset,
    headerOffset + STREAM_HEADER_BYTES,
  );

  const pullState = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
    header,
    streamKey,
  );

  let pos = headerOffset + STREAM_HEADER_BYTES;
  let chunkIndex = 0n;
  let hadFinal = false;
  const decryptedChunks: Uint8Array[] = [];

  while (pos < streamBytes.length) {
    if (hadFinal) {
      throw new Error("Extraneous frames found after stream final tag");
    }
    if (pos + 4 > streamBytes.length) {
      throw new Error("Attachment stream truncated: incomplete frame length");
    }
    const lenView = new DataView(
      streamBytes.buffer,
      streamBytes.byteOffset + pos,
      4,
    );
    const frameLen = lenView.getUint32(0, false);
    pos += 4;

    if (
      frameLen < MIN_FRAME_CIPHERTEXT_BYTES ||
      frameLen > MAX_FRAME_CIPHERTEXT_BYTES
    ) {
      throw new Error(`Frame length out of allowed bounds: ${frameLen}`);
    }
    if (pos + frameLen > streamBytes.length) {
      throw new Error("Attachment stream truncated: frame data truncated");
    }

    const frameBytes = streamBytes.subarray(pos, pos + frameLen);
    pos += frameLen;

    const ad = encodeStreamFrameAD(contextBytes, chunkIndex);
    const pullResult = sodium.crypto_secretstream_xchacha20poly1305_pull(
      pullState,
      frameBytes,
      ad,
    );
    if (!pullResult || typeof pullResult !== "object") {
      throw new Error("Attachment frame authentication failed");
    }

    const { message, tag } = pullResult;
    decryptedChunks.push(message);

    if (tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
      hadFinal = true;
    }

    chunkIndex++;
  }

  if (!hadFinal) {
    throw new Error(
      "Attachment stream missing required final tag (stream was truncated)",
    );
  }

  if (pos !== streamBytes.length) {
    throw new Error("Trailing bytes detected after stream termination");
  }

  let totalBytes = 0;
  for (const c of decryptedChunks) totalBytes += c.length;
  const result = new Uint8Array(totalBytes);
  let writePos = 0;
  for (const c of decryptedChunks) {
    result.set(c, writePos);
    writePos += c.length;
  }
  return result;
}

export { encodeBase64Url, decodeBase64Url };

export type BackupRecordItem = Readonly<{
  objectId: string;
  revision: number;
  payloadVersion: number;
  envelope: ObjectEnvelope;
  ciphertextHash: string;
  updatedAt: string;
}>;

export type BackupAttachmentItem = Readonly<{
  attachmentId: string;
  ciphertextSize: number;
  ciphertextDigest: string;
  ciphertextBase64?: string;
  updatedAt: string;
}>;

export type BackupArchiveManifest = Readonly<{
  formatVersion: 1;
  vaultId: string;
  snapshotId: string;
  createdAt: string;
  recordCount: number;
  attachmentCount: number;
  recordHashes: Readonly<Record<string, string>>;
  attachmentHashes: Readonly<Record<string, string>>;
  rootHash: string;
}>;

export type BackupArchivePayload = Readonly<{
  formatVersion: 1;
  protocolVersion: 1;
  vaultId: string;
  snapshotId: string;
  createdAt: string;
  syncCursor?: string;
  records: readonly BackupRecordItem[];
  attachments: readonly BackupAttachmentItem[];
  manifest: BackupArchiveManifest;
}>;

export type EncryptedBackupPackage = Readonly<{
  formatVersion: 1;
  protocolVersion: 1;
  snapshotId: string;
  vaultId: string;
  createdAt: string;
  algorithm: "AES-256-GCM";
  kdfAlgorithm: "hkdf-sha256";
  salt: string;
  nonce: string;
  keyEnvelopes: readonly VekEnvelope[];
  ciphertext: string;
  ciphertextSize: number;
  ciphertextDigest: string;
  manifestSummary: Readonly<{
    recordCount: number;
    attachmentCount: number;
    rootHash: string;
  }>;
}>;

export async function computeSha256(
  data: Uint8Array,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<Uint8Array> {
  const digestBuffer = await cryptoProvider.subtle.digest(
    "SHA-256",
    copyBuffer(data),
  );
  return new Uint8Array(digestBuffer);
}

export async function computeDigest(
  data: Uint8Array,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<string> {
  const bytes = await computeSha256(data, cryptoProvider);
  return encodeBase64Url(bytes);
}

export async function computeHexDigest(
  data: Uint8Array,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<string> {
  const bytes = await computeSha256(data, cryptoProvider);
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

export async function calculateManifestRootHash(
  manifest: {
    vaultId: string;
    snapshotId: string;
    recordHashes: Readonly<Record<string, string>>;
    attachmentHashes: Readonly<Record<string, string>>;
    keyEnvelopes?: readonly VekEnvelope[];
  },
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<string> {
  const lines: string[] = [
    `vault:${manifest.vaultId}`,
    `snapshot:${manifest.snapshotId}`,
  ];

  const sortedRecordIds = Object.keys(manifest.recordHashes).sort();
  for (const id of sortedRecordIds) {
    lines.push(`record:${id}:${manifest.recordHashes[id]}`);
  }

  const sortedAttIds = Object.keys(manifest.attachmentHashes).sort();
  for (const id of sortedAttIds) {
    lines.push(`attachment:${id}:${manifest.attachmentHashes[id]}`);
  }

  if (manifest.keyEnvelopes) {
    const sortedEnvelopes = [...manifest.keyEnvelopes].sort((a, b) =>
      a.envelopeType.localeCompare(b.envelopeType),
    );
    for (const env of sortedEnvelopes) {
      lines.push(
        `envelope:${env.envelopeType}:${env.keyWrapAlgorithm}:${env.salt}:${env.wrappedVek}`,
      );
    }
  }

  const manifestData = UTF8.encode(lines.join("\n"));
  return computeHexDigest(manifestData, cryptoProvider);
}

export async function deriveBackupKey(
  vek: CryptoKey,
  salt: Uint8Array,
  vaultId: string,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<CryptoKey> {
  assertLength(salt, 16, "backup salt");
  const vaultIdBytes = parseUuid(vaultId);
  const infoPrefix = UTF8.encode("PDV/1/backup-archive-key\u0000");
  const info = new Uint8Array(infoPrefix.length + vaultIdBytes.length);
  info.set(infoPrefix);
  info.set(vaultIdBytes, infoPrefix.length);

  return cryptoProvider.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: copyBuffer(salt),
      info: copyBuffer(info),
    },
    vek,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface SealBackupPackageOptions {
  vaultId: string;
  snapshotId: string;
  createdAt: string;
  keyEnvelopes: readonly VekEnvelope[];
  syncCursor?: string;
  records: readonly BackupRecordItem[];
  attachments: readonly BackupAttachmentItem[];
}

export async function sealBackupPackage(
  vek: CryptoKey,
  options: SealBackupPackageOptions,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<EncryptedBackupPackage> {
  const {
    vaultId,
    snapshotId,
    createdAt,
    keyEnvelopes,
    syncCursor,
    records,
    attachments,
  } = options;

  const recordHashes: Record<string, string> = {};
  for (const r of records) {
    recordHashes[r.objectId] = r.ciphertextHash;
  }

  const attachmentHashes: Record<string, string> = {};
  for (const a of attachments) {
    attachmentHashes[a.attachmentId] = a.ciphertextDigest;
  }

  const rootHash = await calculateManifestRootHash(
    {
      vaultId,
      snapshotId,
      recordHashes,
      attachmentHashes,
      keyEnvelopes,
    },
    cryptoProvider,
  );

  const manifest: BackupArchiveManifest = {
    formatVersion: 1,
    vaultId,
    snapshotId,
    createdAt,
    recordCount: records.length,
    attachmentCount: attachments.length,
    recordHashes,
    attachmentHashes,
    rootHash,
  };

  const payload: BackupArchivePayload = {
    formatVersion: 1,
    protocolVersion: 1,
    vaultId,
    snapshotId,
    createdAt,
    ...(syncCursor ? { syncCursor } : {}),
    records,
    attachments,
    manifest,
  };

  const plaintext = canonicalizeJson(payload);
  const salt = cryptoProvider.getRandomValues(new Uint8Array(16));
  const nonce = cryptoProvider.getRandomValues(
    new Uint8Array(AES_GCM_NONCE_BYTES),
  );
  const backupKey = await deriveBackupKey(vek, salt, vaultId, cryptoProvider);

  const aad = UTF8.encode(`PDV/1/backup:${vaultId}:${snapshotId}`);

  const ciphertextBuffer = await cryptoProvider.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: copyBuffer(nonce),
      additionalData: copyBuffer(aad),
      tagLength: AES_GCM_TAG_BITS,
    },
    backupKey,
    copyBuffer(plaintext),
  );

  const ciphertextBytes = new Uint8Array(ciphertextBuffer);
  const ciphertextDigest = await computeDigest(ciphertextBytes, cryptoProvider);

  return {
    formatVersion: 1,
    protocolVersion: 1,
    snapshotId,
    vaultId,
    createdAt,
    algorithm: "AES-256-GCM",
    kdfAlgorithm: "hkdf-sha256",
    salt: encodeBase64Url(salt),
    nonce: encodeBase64Url(nonce),
    keyEnvelopes,
    ciphertext: encodeBase64Url(ciphertextBytes),
    ciphertextSize: ciphertextBytes.length,
    ciphertextDigest,
    manifestSummary: {
      recordCount: records.length,
      attachmentCount: attachments.length,
      rootHash,
    },
  };
}

export async function openBackupPackage(
  pkg: EncryptedBackupPackage,
  vek: CryptoKey,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<BackupArchivePayload> {
  if (pkg.formatVersion !== 1 || pkg.protocolVersion !== 1) {
    throw new Error(
      `Unsupported backup format version: ${pkg.formatVersion}.${pkg.protocolVersion}`,
    );
  }
  if (pkg.algorithm !== "AES-256-GCM" || pkg.kdfAlgorithm !== "hkdf-sha256") {
    throw new Error(
      `Unsupported backup crypto algorithm: ${pkg.algorithm}/${pkg.kdfAlgorithm}`,
    );
  }

  const salt = decodeBase64Url(pkg.salt);
  assertLength(salt, 16, "backup salt");
  const nonce = decodeBase64Url(pkg.nonce);
  assertLength(nonce, AES_GCM_NONCE_BYTES, "backup nonce");

  const ciphertextBytes = decodeBase64Url(pkg.ciphertext);
  if (ciphertextBytes.length !== pkg.ciphertextSize) {
    throw new Error(
      `Backup ciphertext size mismatch: expected ${pkg.ciphertextSize}, got ${ciphertextBytes.length}`,
    );
  }

  const computedDigest = await computeDigest(ciphertextBytes, cryptoProvider);
  if (computedDigest !== pkg.ciphertextDigest) {
    throw new Error(
      "Backup archive ciphertext digest mismatch (corrupted or tampered archive)",
    );
  }

  const backupKey = await deriveBackupKey(
    vek,
    salt,
    pkg.vaultId,
    cryptoProvider,
  );
  const aad = UTF8.encode(`PDV/1/backup:${pkg.vaultId}:${pkg.snapshotId}`);

  let plaintextBuffer: ArrayBuffer;
  try {
    plaintextBuffer = await cryptoProvider.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: copyBuffer(nonce),
        additionalData: copyBuffer(aad),
        tagLength: AES_GCM_TAG_BITS,
      },
      backupKey,
      copyBuffer(ciphertextBytes),
    );
  } catch {
    throw new Error(
      "Backup archive decryption failed (invalid key or tampered ciphertext)",
    );
  }

  const plaintextJson = new TextDecoder().decode(plaintextBuffer);
  let payload: BackupArchivePayload;
  try {
    payload = JSON.parse(plaintextJson);
  } catch {
    throw new Error("Failed to parse decrypted backup archive payload");
  }

  if (
    payload.formatVersion !== 1 ||
    payload.vaultId !== pkg.vaultId ||
    payload.snapshotId !== pkg.snapshotId
  ) {
    throw new Error(
      "Backup archive payload headers do not match archive container metadata",
    );
  }

  const manifest = payload.manifest;
  if (!manifest || manifest.rootHash !== pkg.manifestSummary.rootHash) {
    throw new Error(
      "Backup archive root hash mismatch between payload manifest and outer container",
    );
  }

  for (const record of payload.records) {
    const expectedHash = manifest.recordHashes[record.objectId];
    if (!expectedHash || expectedHash !== record.ciphertextHash) {
      throw new Error(
        `Integrity check failed: record ${record.objectId} ciphertext hash does not match manifest`,
      );
    }
  }

  for (const att of payload.attachments) {
    const expectedDigest = manifest.attachmentHashes[att.attachmentId];
    if (!expectedDigest || expectedDigest !== att.ciphertextDigest) {
      throw new Error(
        `Integrity check failed: attachment ${att.attachmentId} digest does not match manifest`,
      );
    }
  }

  const recomputedRoot = await calculateManifestRootHash(
    {
      vaultId: pkg.vaultId,
      snapshotId: pkg.snapshotId,
      recordHashes: manifest.recordHashes,
      attachmentHashes: manifest.attachmentHashes,
      keyEnvelopes: pkg.keyEnvelopes,
    },
    cryptoProvider,
  );

  if (recomputedRoot !== manifest.rootHash) {
    throw new Error(
      "Integrity check failed: recomputed manifest root hash does not match archive manifest",
    );
  }

  return payload;
}
