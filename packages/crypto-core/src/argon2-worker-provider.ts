import type { Argon2idParameters, Argon2idProvider } from "./index.ts";

/** Run the isolated Rust/WASM candidate in a dedicated worker per derivation. */
export class WorkerArgon2idProvider implements Argon2idProvider {
  private readonly module: WebAssembly.Module;
  private readonly workerFactory: () => Worker;
  private readonly timeoutMs: number;

  constructor(
    module: WebAssembly.Module,
    workerFactory: () => Worker = () =>
      new Worker(new URL("./argon2.worker.ts", import.meta.url), {
        type: "module",
      }),
    timeoutMs = 120_000,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError("Invalid Argon2id worker timeout");
    }
    this.module = module;
    this.workerFactory = workerFactory;
    this.timeoutMs = timeoutMs;
  }

  deriveKey(
    passwordUtf8: Uint8Array,
    salt: Uint8Array,
    parameters: Argon2idParameters,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (signal?.aborted) return Promise.reject(abortError());
    let worker: Worker;
    try {
      worker = this.workerFactory();
    } catch {
      return Promise.reject(new Error("Unable to start Argon2id worker"));
    }
    const password = Uint8Array.from(passwordUtf8);
    const saltCopy = Uint8Array.from(salt);
    const passwordBuffer = password.buffer;
    const saltBuffer = saltCopy.buffer;

    return new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      let onTimeout = (): void => {};
      const timeout = setTimeout(() => onTimeout(), this.timeoutMs);
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
        action();
      };
      onTimeout = () =>
        finish(() => reject(new Error("Argon2id worker timed out")));
      const onAbort = (): void => {
        try {
          password.fill(0);
        } catch {
          /* detached after postMessage transfer */
        }
        try {
          saltCopy.fill(0);
        } catch {
          /* detached after postMessage transfer */
        }
        finish(() => reject(abortError()));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      worker.onmessage = ({ data }: MessageEvent) => {
        if (data?.type === "result" && data.result instanceof ArrayBuffer) {
          const result = new Uint8Array(data.result);
          if (result.byteLength !== 32) {
            result.fill(0);
            finish(() => reject(new Error("Invalid Argon2id output length")));
            return;
          }
          finish(() => resolve(result));
        } else {
          finish(() =>
            reject(new Error(data?.message ?? "Argon2id worker failed")),
          );
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(() => reject(new Error("Argon2id worker execution failed")));
      };
      worker.onmessageerror = () =>
        finish(() => reject(new Error("Argon2id worker message failed")));
      try {
        worker.postMessage(
          {
            type: "derive",
            module: this.module,
            password: passwordBuffer,
            salt: saltBuffer,
            parameters,
          },
          [passwordBuffer, saltBuffer],
        );
      } catch {
        password.fill(0);
        saltCopy.fill(0);
        finish(() => reject(new Error("Unable to start Argon2id worker")));
      }
    });
  }
}

function abortError(): DOMException {
  return new DOMException("Argon2id derivation cancelled", "AbortError");
}
