import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const browserDir = dirname(fileURLToPath(import.meta.url));
const crateDir = dirname(browserDir);
const wasmPath = join(
  crateDir,
  "target",
  "wasm32-unknown-unknown",
  "release",
  "pdv_argon2_wasm_candidate.wasm",
);
const chromePath =
  process.env.CHROME_BIN ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const expectedP1 =
  "daf16780dcb73e862146297fa17b81b86b480f33c0b67daef0f2c7c809c5797b";
const expectedP4 =
  "b8a64b68dea6b88ca8c8862be706aac37cbecda0db7bd68b48f8fa2e7feb6f3e";
const wasmBase64 = readFileSync(wasmPath).toString("base64");
const workerSource = `
const wasmBase64 = "${wasmBase64}";
const expectedP1 = "${expectedP1}";
const expectedP4 = "${expectedP4}";
const toHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
onmessage = async ({ data }) => {
  try {
    if (data === "derive") {
      postMessage({ type: "started" });
      const bytes = Uint8Array.from(atob(wasmBase64), (char) => char.charCodeAt(0));
      const { instance } = await WebAssembly.instantiate(bytes);
      const wasm = instance.exports;
      const allocate = (value) => {
        const pointer = wasm.pdv_alloc(value.length);
        if (pointer === 0) throw new Error("WASM allocation failed");
        new Uint8Array(wasm.memory.buffer, pointer, value.length).set(value);
        return pointer;
      };
      const password = new TextEncoder().encode("password");
      const salt = new TextEncoder().encode("0123456789abcdef");
      const passwordPointer = allocate(password);
      const saltPointer = allocate(salt);
      const outputPointer = wasm.pdv_alloc(32);
      if (outputPointer === 0) throw new Error("WASM output allocation failed");
      const legacyStatus = wasm.pdv_derive_key(passwordPointer, password.length, saltPointer, salt.length, outputPointer, 32);
      if (legacyStatus !== 0 || toHex(new Uint8Array(wasm.memory.buffer, outputPointer, 32)) !== expectedP1) throw new Error("legacy p=1 vector mismatch");
      const timings = [];
      for (let index = 0; index < 6; index += 1) {
        const start = performance.now();
        const status = wasm.pdv_derive_key_p4(passwordPointer, password.length, saltPointer, salt.length, outputPointer, 32);
        timings.push(performance.now() - start);
        if (status !== 0) throw new Error("derive status " + status);
        if (toHex(new Uint8Array(wasm.memory.buffer, outputPointer, 32)) !== expectedP4) throw new Error("PDV tuple vector mismatch");
      }
      timings.sort((left, right) => left - right);
      postMessage({ type: "result", vector: expectedP4, timings, memoryBytes: wasm.memory.buffer.byteLength });
      wasm.pdv_free(passwordPointer, password.length);
      wasm.pdv_free(saltPointer, salt.length);
      wasm.pdv_free(outputPointer, 32);
    } else if (data === "invalid") {
      const bytes = Uint8Array.from(atob(wasmBase64), (char) => char.charCodeAt(0));
      const { instance } = await WebAssembly.instantiate(bytes);
      postMessage({ type: "error", status: instance.exports.pdv_derive_key(1, 1, 1, 0, 1, 32) });
    } else if (data === "cancel") {
      const bytes = Uint8Array.from(atob(wasmBase64), (char) => char.charCodeAt(0));
      const { instance } = await WebAssembly.instantiate(bytes);
      const wasm = instance.exports;
      const password = new TextEncoder().encode("password");
      const salt = new TextEncoder().encode("0123456789abcdef");
      const allocate = (value) => {
        const pointer = wasm.pdv_alloc(value.length);
        new Uint8Array(wasm.memory.buffer, pointer, value.length).set(value);
        return pointer;
      };
      const passwordPointer = allocate(password);
      const saltPointer = allocate(salt);
      const outputPointer = wasm.pdv_alloc(32);
      postMessage({ type: "deriving" });
      const status = wasm.pdv_derive_key(passwordPointer, password.length, saltPointer, salt.length, outputPointer, 32);
      postMessage({ type: "cancel-result", status });
    }
  } catch (error) {
    postMessage({ type: "error", message: String(error) });
  }
};
`;

const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>PDV Argon2 Worker validation</title></head>
<body><pre id="result">RUNNING</pre><script>
const output = document.querySelector("#result");
const workerUrl = URL.createObjectURL(new Blob([${JSON.stringify(workerSource)}], { type: "text/javascript" }));
const makeWorker = () => new Worker(workerUrl);
(async () => {
  try {
    let heartbeatTicks = 0;
    const heartbeat = setInterval(() => { heartbeatTicks += 1; }, 5);
    const worker = makeWorker();
    const benchmark = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("derive worker timeout")), 30000);
      worker.onerror = (event) => { clearTimeout(timeout); reject(new Error("worker error: " + event.message)); };
      worker.onmessage = ({ data }) => {
        if (data.type === "result") { clearTimeout(timeout); resolve(data); }
        if (data.type === "error") { clearTimeout(timeout); reject(new Error(JSON.stringify(data))); }
      };
      worker.postMessage("derive");
    });
    worker.terminate();
    clearInterval(heartbeat);

    const invalidWorker = makeWorker();
    const invalid = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("invalid-input worker timeout")), 15000);
      invalidWorker.onerror = (event) => { clearTimeout(timeout); reject(new Error(event.message)); };
      invalidWorker.onmessage = ({ data }) => {
        if (data.type === "error") { clearTimeout(timeout); resolve(data); }
      };
      invalidWorker.postMessage("invalid");
    });
    invalidWorker.terminate();

    const cancelWorker = makeWorker();
    let resultArrived = false;
    const cancellation = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cancelWorker.terminate(); reject(new Error("cancel worker timeout")); }, 15000);
      cancelWorker.onerror = (event) => { clearTimeout(timeout); reject(new Error(event.message)); };
      cancelWorker.onmessage = ({ data }) => {
        if (data.type === "deriving") {
          clearTimeout(timeout);
          setTimeout(() => {
            cancelWorker.terminate();
            setTimeout(() => resolve({ noResultAfterTermination: !resultArrived }), 100);
          }, 10);
        }
        if (data.type === "cancel-result") resultArrived = true;
        if (data.type === "error") { clearTimeout(timeout); reject(new Error(JSON.stringify(data))); }
      };
      cancelWorker.postMessage("cancel");
    });

    URL.revokeObjectURL(workerUrl);
    const times = benchmark.timings;
    output.textContent = JSON.stringify({
      pass: benchmark.vector === "${expectedP4}" && times.length === 6 && heartbeatTicks > 0 && invalid.status === 1 && cancellation.noResultAfterTermination,
      vector: benchmark.vector,
      repetitions: times.length,
      medianMs: Number(times[3].toFixed(2)),
      minMs: Number(times[0].toFixed(2)),
      maxMs: Number(times[5].toFixed(2)),
      wasmLinearMemoryBytes: benchmark.memoryBytes,
      mainThreadHeartbeatTicks: heartbeatTicks,
      invalidInputStatus: invalid.status,
      cancellation,
    });
  } catch (error) {
    output.textContent = JSON.stringify({ pass: false, error: String(error) });
  }
})();
</script></body></html>`;

const pageDir = mkdtempSync(join(tmpdir(), "pdv-kdf-worker-page-"));
const profileDir = mkdtempSync(join(tmpdir(), "pdv-kdf-worker-profile-"));
const pagePath = join(pageDir, "index.html");
writeFileSync(pagePath, pageHtml, "utf8");

let stderr = "";
let chrome;
let socket;
try {
  chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--no-sandbox",
      "--allow-file-access-from-files",
      "--disable-gpu",
      "--disable-background-networking",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      pathToFileURL(pagePath).href,
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
  );
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const endpointDeadline = Date.now() + 15000;
  let endpoint;
  while (Date.now() < endpointDeadline) {
    endpoint = stderr.match(
      /(ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/u,
    )?.[1];
    if (endpoint) break;
    if (chrome.exitCode !== null)
      throw new Error(`Chrome exited with ${chrome.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!endpoint) throw new Error("Chrome DevTools endpoint timed out");

  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const handlers = pending.get(message.id);
    pending.delete(message.id);
    if (message.error)
      handlers.reject(new Error(JSON.stringify(message.error)));
    else handlers.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });

  const targets = await send("Target.getTargets");
  const target = targets.targetInfos.find(
    (item) => item.type === "page" && item.url === pathToFileURL(pagePath).href,
  );
  if (!target) throw new Error("Validation page target was not found");
  const { sessionId } = await send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  await send("Runtime.enable", {}, sessionId);
  const expression = `new Promise((resolve, reject) => { const deadline = Date.now() + 60000; const poll = () => { const value = document.querySelector('#result')?.textContent; if (value && value !== 'RUNNING') resolve(value); else if (Date.now() > deadline) reject(Error('validation result timeout')); else setTimeout(poll, 25); }; poll(); })`;
  const evaluation = await send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (evaluation.exceptionDetails)
    throw new Error(evaluation.exceptionDetails.text);
  const result = evaluation.result?.value;
  if (!result) throw new Error("Chrome returned no worker validation result");
  console.log(result);
  const parsed = JSON.parse(result);
  if (!parsed.pass) process.exitCode = 1;
} catch (error) {
  console.error(
    `Chrome Worker validation failed: ${String(error)}\n${stderr.slice(-1200)}`,
  );
  process.exitCode = 1;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      await new Promise((resolve) => {
        const closeId = 999999;
        const listener = (event) => {
          const message = JSON.parse(event.data);
          if (
            message.id === closeId ||
            message.method === "Inspector.detached"
          ) {
            socket.removeEventListener("message", listener);
            resolve();
          }
        };
        socket.addEventListener("message", listener);
        socket.send(JSON.stringify({ id: closeId, method: "Browser.close" }));
        setTimeout(resolve, 2000);
      });
    } catch {
      /* Chrome may close the socket before acknowledging. */
    }
  }
  if (chrome && chrome.exitCode === null) {
    chrome.kill();
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
  socket?.close();
  rmSync(pageDir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
  rmSync(profileDir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
