import {
  unwrapVekWithPassword,
  unwrapVekWithRecovery,
  createVekEnvelopes,
  sealObject,
  openObject,
  encodeRecoverySecret,
  decodeRecoverySecret,
  type Argon2idParameters,
  type Argon2idProvider,
  type VekEnvelope,
  type ObjectEnvelope,
  type ObjectContext,
} from "@pdv/crypto-core";
import { browser } from "wxt/browser";

let wasmModulePromise: Promise<WebAssembly.Module> | null = null;

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

export function setCustomArgon2Provider(
  provider: Argon2idProvider | null,
): void {
  cachedProvider = provider;
}

export async function getArgon2Module(): Promise<WebAssembly.Module> {
  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      let wasmBytes: ArrayBuffer | null = null;

      // 1. In browser extension runtime
      if (typeof browser !== "undefined" && browser.runtime?.getURL) {
        try {
          const url = (browser.runtime.getURL as (path: string) => string)(
            "/pdv_argon2_wasm_candidate.wasm",
          );
          const res = await fetch(url);
          if (res.ok) {
            wasmBytes = await res.arrayBuffer();
          }
        } catch {
          // fallback to relative fetch
        }
      }

      // 2. Browser relative fetch or Node fetch
      if (!wasmBytes && typeof fetch !== "undefined") {
        try {
          const res = await fetch("/pdv_argon2_wasm_candidate.wasm");
          if (res.ok) {
            wasmBytes = await res.arrayBuffer();
          }
        } catch {
          // continue to next fallback
        }
      }

      // 3. Node.js environment (e.g. Vitest test runner)
      if (
        !wasmBytes &&
        typeof process !== "undefined" &&
        process.versions?.node
      ) {
        try {
          const { readFileSync, existsSync } = await import("node:fs");
          const { resolve } = await import("node:path");
          const candidates = [
            resolve(
              process.cwd(),
              "apps/extension/public/pdv_argon2_wasm_candidate.wasm",
            ),
            resolve(process.cwd(), "public/pdv_argon2_wasm_candidate.wasm"),
            resolve(
              process.cwd(),
              "packages/crypto-core/argon2-wasm/target/wasm32-unknown-unknown/release/pdv_argon2_wasm_candidate.wasm",
            ),
          ];
          for (const cand of candidates) {
            if (existsSync(cand)) {
              const buffer = readFileSync(cand);
              wasmBytes = buffer.buffer.slice(
                buffer.byteOffset,
                buffer.byteOffset + buffer.byteLength,
              );
              break;
            }
          }
        } catch {
          // ignore
        }
      }

      if (!wasmBytes) {
        throw new Error(
          "Unable to locate and compile pdv_argon2_wasm_candidate.wasm",
        );
      }

      return WebAssembly.compile(wasmBytes);
    })();
  }
  return wasmModulePromise;
}

export async function getArgon2Provider(): Promise<Argon2idProvider> {
  if (!cachedProvider) {
    const wasmModule = await getArgon2Module();
    cachedProvider = new DirectArgon2idProvider(wasmModule);
  }
  return cachedProvider;
}

export {
  unwrapVekWithPassword,
  unwrapVekWithRecovery,
  createVekEnvelopes,
  sealObject,
  openObject,
  encodeRecoverySecret,
  decodeRecoverySecret,
  type Argon2idParameters,
  type Argon2idProvider,
  type VekEnvelope,
  type ObjectEnvelope,
  type ObjectContext,
};
