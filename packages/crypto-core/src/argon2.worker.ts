import type { Argon2idParameters } from "./index";

type DeriveRequest = {
  type: "derive";
  module: WebAssembly.Module;
  password: ArrayBuffer;
  salt: ArrayBuffer;
  parameters: Argon2idParameters;
};

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<DeriveRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  close(): void;
};

scope.onmessage = async ({ data }: MessageEvent<DeriveRequest>) => {
  if (data?.type !== "derive") return;
  const password = new Uint8Array(data.password);
  const salt = new Uint8Array(data.salt);
  let instance: WebAssembly.Instance | undefined;
  const allocations: Array<{ pointer: number; length: number }> = [];
  try {
    if (
      data.parameters.version !== 19 ||
      data.parameters.memoryKiB !== 65_536 ||
      data.parameters.iterations !== 3 ||
      (data.parameters.parallelism !== 1 &&
        data.parameters.parallelism !== 4) ||
      salt.byteLength !== 16 ||
      password.byteLength > 1024 * 1024
    ) {
      throw new Error("Invalid Argon2id request");
    }
    instance = await WebAssembly.instantiate(data.module, {});
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
    const allocate = (bytes: Uint8Array): number => {
      const length = Math.max(bytes.byteLength, 1);
      const pointer = wasm.pdv_alloc(length);
      if (pointer === 0) throw new Error("WASM allocation failed");
      allocations.push({ pointer, length });
      new Uint8Array(wasm.memory.buffer, pointer, length).set(bytes);
      return pointer;
    };
    const passwordPointer = allocate(password);
    const saltPointer = allocate(salt);
    const outputPointer = wasm.pdv_alloc(32);
    if (outputPointer === 0) throw new Error("WASM allocation failed");
    allocations.push({ pointer: outputPointer, length: 32 });
    const derive =
      data.parameters.parallelism === 4
        ? wasm.pdv_derive_key_p4
        : wasm.pdv_derive_key;
    const status = derive(
      passwordPointer,
      password.byteLength,
      saltPointer,
      salt.byteLength,
      outputPointer,
      32,
    );
    if (status !== 0) throw new Error(`Argon2id failed with status ${status}`);
    const result = new Uint8Array(
      wasm.memory.buffer,
      outputPointer,
      32,
    ).slice();
    scope.postMessage({ type: "result", result: result.buffer }, [
      result.buffer,
    ]);
  } catch (error) {
    scope.postMessage({
      type: "error",
      message:
        error instanceof Error ? error.message : "Argon2id worker failed",
    });
  } finally {
    password.fill(0);
    salt.fill(0);
    if (instance) {
      const exports = instance.exports as unknown as {
        pdv_free(pointer: number, length: number): void;
      };
      for (const allocation of allocations.reverse()) {
        exports.pdv_free(allocation.pointer, allocation.length);
      }
    }
    scope.close();
  }
};
