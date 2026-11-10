import {
  createVekEnvelopes,
  rewrapVekWithPassword,
  unwrapVekWithPassword,
  unwrapVekWithRecovery,
  encodeRecoverySecret,
  decodeRecoverySecret,
  type Argon2idParameters,
  type Argon2idProvider,
  type VekEnvelope,
} from "@pdv/crypto-core";
import type { VaultKeyEnvelope } from "./api";

let wasmModulePromise: Promise<WebAssembly.Module> | null = null;

export async function getArgon2Module(): Promise<WebAssembly.Module> {
  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      const res = await fetch("/pdv_argon2_wasm_candidate.wasm");
      if (!res.ok) {
        throw new Error(
          `Failed to load Argon2id WASM module: HTTP ${res.status}`,
        );
      }
      const bytes = await res.arrayBuffer();
      return WebAssembly.compile(bytes);
    })();
  }
  return wasmModulePromise;
}

export class DirectArgon2idProvider implements Argon2idProvider {
  constructor(private readonly module: WebAssembly.Module) {}

  async deriveKey(
    passwordUtf8: Uint8Array,
    salt: Uint8Array,
    parameters: Argon2idParameters,
  ): Promise<Uint8Array> {
    const instance = await WebAssembly.instantiate(this.module, {});
    const wasm = instance.exports as unknown as {
      memory: WebAssembly.Memory;
      pdv_alloc(length: number): number;
      pdv_free(pointer: number, length: number): void;
      pdv_derive_key(
        passwordPointer: number,
        passwordLength: number,
        saltPointer: number,
        saltLength: number,
        outputPointer: number,
        outputLength: number,
      ): number;
      pdv_derive_key_p4(
        passwordPointer: number,
        passwordLength: number,
        saltPointer: number,
        saltLength: number,
        outputPointer: number,
        outputLength: number,
      ): number;
    };

    const allocate = (bytes: Uint8Array): [number, number] => {
      const length = Math.max(bytes.byteLength, 1);
      const pointer = wasm.pdv_alloc(length);
      if (pointer === 0) throw new Error("WASM allocation failed");
      new Uint8Array(wasm.memory.buffer, pointer, length).set(bytes);
      return [pointer, length];
    };

    const [pwPtr, pwLen] = allocate(passwordUtf8);
    const [saltPtr, saltLen] = allocate(salt);
    const outPtr = wasm.pdv_alloc(32);
    if (outPtr === 0) {
      wasm.pdv_free(pwPtr, pwLen);
      wasm.pdv_free(saltPtr, saltLen);
      throw new Error("WASM allocation failed");
    }

    try {
      const derive =
        parameters.parallelism === 4
          ? wasm.pdv_derive_key_p4
          : wasm.pdv_derive_key;
      const status = derive(pwPtr, pwLen, saltPtr, saltLen, outPtr, 32);
      if (status !== 0) {
        throw new Error(`Argon2id KDF derivation failed with status ${status}`);
      }
      return new Uint8Array(wasm.memory.buffer, outPtr, 32).slice();
    } finally {
      wasm.pdv_free(pwPtr, pwLen);
      wasm.pdv_free(saltPtr, saltLen);
      wasm.pdv_free(outPtr, 32);
    }
  }
}

let cachedProvider: Argon2idProvider | null = null;

export async function getArgon2Provider(): Promise<Argon2idProvider> {
  if (!cachedProvider) {
    const wasmModule = await getArgon2Module();
    cachedProvider = new DirectArgon2idProvider(wasmModule);
  }
  return cachedProvider;
}

export async function createVaultKeyEnvelopes(password: string): Promise<{
  vek: CryptoKey;
  recoverySecret: string;
  passwordEnvelope: VaultKeyEnvelope;
  recoveryEnvelope: VaultKeyEnvelope;
}> {
  const provider = await getArgon2Provider();
  const created = await createVekEnvelopes(password, provider);
  const recoverySecretStr = encodeRecoverySecret(created.recoverySecret);
  return {
    vek: created.vek,
    recoverySecret: recoverySecretStr,
    passwordEnvelope: created.passwordEnvelope as unknown as VaultKeyEnvelope,
    recoveryEnvelope: created.recoveryEnvelope as unknown as VaultKeyEnvelope,
  };
}

export async function unlockWithPassword(
  password: string,
  envelope: VaultKeyEnvelope,
): Promise<CryptoKey> {
  const provider = await getArgon2Provider();
  return unwrapVekWithPassword(
    password,
    envelope as unknown as VekEnvelope,
    provider,
  );
}

export async function unlockWithRecovery(
  recoverySecretStr: string,
  envelope: VaultKeyEnvelope,
): Promise<CryptoKey> {
  const recoveryBytes = decodeRecoverySecret(recoverySecretStr.trim());
  return unwrapVekWithRecovery(
    recoveryBytes,
    envelope as unknown as VekEnvelope,
  );
}

export async function changePassword(
  currentPassword: string,
  currentEnvelope: VaultKeyEnvelope,
  newPassword: string,
): Promise<{ vek: CryptoKey; passwordEnvelope: VaultKeyEnvelope }> {
  const provider = await getArgon2Provider();
  const res = await rewrapVekWithPassword(
    currentPassword,
    currentEnvelope as unknown as VekEnvelope,
    newPassword,
    provider,
  );
  return {
    vek: res.vek,
    passwordEnvelope: res.passwordEnvelope as unknown as VaultKeyEnvelope,
  };
}
