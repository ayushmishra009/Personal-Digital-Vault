import { spawnSync } from "node:child_process";
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
const profilePath = mkdtempSync(join(tmpdir(), "pdv-chrome-wasm-"));
const testDir = mkdtempSync(join(tmpdir(), "pdv-chrome-page-"));
const testPagePath = join(testDir, "index.html");
const wasmBase64 = readFileSync(wasmPath).toString("base64");
const html = readFileSync(join(browserDir, "index.html"), "utf8").replace(
  "__PDV_WASM_BASE64__",
  wasmBase64,
);
writeFileSync(testPagePath, html, "utf8");

try {
  const url = pathToFileURL(testPagePath).href;
  const chrome = spawnSync(
    chromePath,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--virtual-time-budget=10000",
      `--user-data-dir=${profilePath}`,
      "--dump-dom",
      url,
    ],
    { encoding: "utf8", timeout: 30_000, windowsHide: true },
  );
  const output = `${chrome.stdout ?? ""}\n${chrome.stderr ?? ""}`;
  const match = output.match(/<pre id="result">([^<]+)<\/pre>/u);
  if (chrome.error) {
    throw new Error(`Chrome ${chrome.error.code}: ${output.slice(-2000)}`);
  }
  if (chrome.status !== 0) {
    throw new Error(
      `Chrome exited with ${chrome.status}: ${output.slice(-2000)}`,
    );
  }
  if (!match || !match[1].startsWith("PASS:")) {
    throw new Error(
      `Chrome compatibility checks failed: ${match?.[1] ?? output.slice(-2000)}`,
    );
  }
  console.log(match[1]);
} finally {
  rmSync(profilePath, { recursive: true, force: true });
  rmSync(testDir, { recursive: true, force: true });
}
