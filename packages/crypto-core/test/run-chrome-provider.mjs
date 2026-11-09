import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "../../../apps/vault-web/node_modules/vite/dist/node/index.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const browserDir = join(here, "browser");
const wasmPath = join(
  repoRoot,
  "packages",
  "crypto-core",
  "argon2-wasm",
  "target",
  "wasm32-unknown-unknown",
  "release",
  "pdv_argon2_wasm_candidate.wasm",
);
const htmlPath = join(browserDir, ".provider-run.html");
const profilePath = mkdtempSync(join(tmpdir(), "pdv-provider-chrome-"));
const chromePath =
  process.env.CHROME_BIN ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const html = readFileSync(join(browserDir, "index.html"), "utf8").replace(
  "__PDV_WASM_BASE64__",
  readFileSync(wasmPath).toString("base64"),
);
writeFileSync(htmlPath, html, "utf8");

let server;
let chrome;
let socket;
let stderr = "";
try {
  server = await createServer({
    root: browserDir,
    configFile: false,
    server: { host: "127.0.0.1", port: 0, fs: { allow: [repoRoot] } },
  });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  const pageUrl = `http://127.0.0.1:${address.port}/.provider-run.html`;
  chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
      "--remote-debugging-port=0",
      `--user-data-dir=${profilePath}`,
      pageUrl,
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
  );
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const deadline = Date.now() + 15_000;
  let endpoint;
  while (Date.now() < deadline) {
    endpoint = stderr.match(
      /(ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/u,
    )?.[1];
    if (endpoint) break;
    if (chrome.exitCode !== null)
      throw new Error(`Chrome exited ${chrome.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(endpoint, "Chrome DevTools endpoint started");
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(JSON.stringify(message.error)));
    else handler.resolve(message.result);
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
    (item) => item.type === "page" && item.url === pageUrl,
  );
  assert.ok(target, "Chrome opened the provider page");
  const { sessionId } = await send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  const evaluationParams = {
    expression: `new Promise((resolve, reject) => { const end = Date.now() + 30000; const poll = () => { const value = document.querySelector('#result')?.textContent; if (value && value !== 'RUNNING') resolve(value); else if (Date.now() > end) reject(Error('provider result timeout')); else setTimeout(poll, 25); }; poll(); })`,
    awaitPromise: true,
    returnByValue: true,
  };
  let evaluation;
  const resultDeadline = Date.now() + 35_000;
  while (Date.now() < resultDeadline) {
    try {
      evaluation = await send("Runtime.evaluate", evaluationParams, sessionId);
      break;
    } catch (error) {
      if (!String(error).includes("Execution context was destroyed"))
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(evaluation, "Chrome page result was evaluated");
  if (evaluation.exceptionDetails)
    throw new Error(evaluation.exceptionDetails.text);
  const result = JSON.parse(evaluation.result?.value ?? "null");
  assert.equal(result.pass, true, JSON.stringify(result));
  console.log(JSON.stringify(result));
} catch (error) {
  throw new Error(`${String(error)}\n${stderr.slice(-1000)}`);
} finally {
  if (server) await server.close();
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  if (chrome && chrome.exitCode === null) {
    chrome.kill();
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
  rmSync(htmlPath, { force: true });
  rmSync(profilePath, { recursive: true, force: true });
}
