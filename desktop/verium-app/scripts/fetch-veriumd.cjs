#!/usr/bin/env node
/**
 * Fetch the platform-matched `veriumd` binary and place it under
 * `src-tauri/binaries/veriumd-<target-triple>{.exe}` so that Tauri can bundle
 * it as a sidecar.
 *
 * Usage:
 *   node scripts/fetch-veriumd.cjs              # current host platform
 *   node scripts/fetch-veriumd.cjs --triple=... # explicit target triple
 *   VERIUMD_DOWNLOAD_BASE=... node scripts/fetch-veriumd.cjs
 *   VERIUMD_LOCAL=/path/to/veriumd node scripts/fetch-veriumd.cjs
 *
 * Environment:
 *   VERIUMD_DOWNLOAD_BASE  Override base URL (default: files.vericonomy.com/vrm/releases/)
 *   VERIUMD_VERSION        Version to fetch (default: latest from releases-manifest.json)
 *   VERIUMD_LOCAL          Path to an already-built veriumd to copy instead of download
 *   VERIUMD_SKIP_IF_PRESENT=1  Exit success if the sidecar already exists
 *   VERIUMD_FORCE=1        Overwrite existing sidecar
 *   VERIUMD_TARGET_TRIPLE  Explicit Rust target triple (overrides auto-detect)
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const os = require("node:os");
const https = require("node:https");
const http = require("node:http");
const zlib = require("node:zlib");

const ROOT = path.resolve(__dirname, "..");
const TAURI_DIR = path.join(ROOT, "src-tauri");
const BINARIES_DIR = path.join(TAURI_DIR, "binaries");
const MANIFEST_PATH = path.join(
  ROOT,
  "src",
  "lib",
  "releases-manifest.json",
);

const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=");
      out[k] = v ?? true;
    }
  }
  return out;
}

function log(msg) {
  process.stdout.write(`[fetch-veriumd] ${msg}\n`);
}

function detectTargetTriple() {
  if (process.env.VERIUMD_TARGET_TRIPLE)
    return process.env.VERIUMD_TARGET_TRIPLE;
  if (args.triple) return args.triple;
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const m = out.match(/^host:\s*(\S+)/m);
    if (m) return m[1];
  } catch (e) {
    log(`rustc not on PATH; falling back to platform default (${e.message})`);
  }
  switch (`${process.platform}-${process.arch}`) {
    case "win32-x64":
      return "x86_64-pc-windows-msvc";
    case "win32-arm64":
      return "aarch64-pc-windows-msvc";
    case "darwin-x64":
      return "x86_64-apple-darwin";
    case "darwin-arm64":
      return "aarch64-apple-darwin";
    case "linux-x64":
      return "x86_64-unknown-linux-gnu";
    case "linux-arm64":
      return "aarch64-unknown-linux-gnu";
    default:
      throw new Error(
        `Unsupported host: ${process.platform}-${process.arch}; pass --triple=...`,
      );
  }
}

function isWindowsTriple(t) {
  return t.includes("windows");
}

function isMacTriple(t) {
  return t.includes("apple-darwin");
}

function defaultVersion() {
  if (process.env.VERIUMD_VERSION) return process.env.VERIUMD_VERSION;
  if (args.version) return args.version;
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    return m.latest?.version;
  } catch {
    return undefined;
  }
}

/**
 * Build platform-specific archive URLs (newest CDN layout first, then fallbacks).
 * Files live under https://files.vericonomy.com/vrm/releases/<version>/
 */
function archiveUrlsFor(triple, version) {
  if (process.env.VERIUMD_DOWNLOAD_URL) return [process.env.VERIUMD_DOWNLOAD_URL];
  const baseRoot =
    process.env.VERIUMD_DOWNLOAD_BASE ||
    "https://files.vericonomy.com/vrm/releases/";
  const v = version ?? "1.3.5.2";
  const vBase = `${baseRoot}${v}/`;
  const legacy = `${baseRoot}1.3.5/`;

  if (isWindowsTriple(triple)) {
    return [
      `${vBase}verium-x86_64-w64.zip`,
      `${vBase}verium-${v}-x86_64-w64.zip`,
      `${legacy}verium-1.3.5-x86_64-w64.zip`,
    ];
  }
  if (isMacTriple(triple)) {
    // CDN ships Intel macOS builds only; Apple Silicon CI cross-compiles to x86_64.
    return [
      `${vBase}verium-${v}-macos-intel.tar.gz`,
      `${legacy}verium-1.3.5-x86_64-apple-darwin.zip`,
    ];
  }
  if (triple.includes("aarch64") && triple.includes("linux")) {
    return [
      `${vBase}verium-${v}-aarch64-linux-gnu.tar.gz`,
      `${legacy}verium-1.3.5-aarch64-linux-gnu.tar.gz`,
    ];
  }
  return [
    `${vBase}verium-${v}-x86_64-pc-linux-gnu.tar.gz`,
    `${legacy}verium-1.3.5-x86_64-pc-linux-gnu.tar.gz`,
  ];
}

const MIN_REAL_BINARY_BYTES = 100_000;

function isStubSidecar(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.size < MIN_REAL_BINARY_BYTES;
  } catch {
    return false;
  }
}

function sidecarPath(triple) {
  const ext = isWindowsTriple(triple) ? ".exe" : "";
  return path.join(BINARIES_DIR, `veriumd-${triple}${ext}`);
}

async function fetchToBuffer(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https://") ? https : http;
    const req = client.get(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        if (redirectsLeft <= 0)
          return reject(new Error(`Too many redirects (${url})`));
        res.resume();
        return resolve(fetchToBuffer(res.headers.location, redirectsLeft - 1));
      }
      if (status !== 200) {
        return reject(
          new Error(`HTTP ${status} fetching ${url}: ${res.statusMessage}`),
        );
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

function ensureBinariesDir() {
  fs.mkdirSync(BINARIES_DIR, { recursive: true });
}

function copyLocalBinary(localPath, destPath) {
  if (!fs.existsSync(localPath)) {
    throw new Error(`VERIUMD_LOCAL points at missing file: ${localPath}`);
  }
  fs.copyFileSync(localPath, destPath);
  if (process.platform !== "win32") fs.chmodSync(destPath, 0o755);
  log(`copied ${localPath} -> ${destPath}`);
}

/** Extract the `veriumd` binary out of a zip into destPath. */
function extractZip(zipBuffer, destPath, isWindows) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "veriumd-fetch-"));
  const zipPath = path.join(tmp, "archive.zip");
  fs.writeFileSync(zipPath, zipBuffer);
  // Use system unzip / tar / Expand-Archive depending on platform
  let extracted = false;
  if (process.platform === "win32") {
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmp}' -Force`,
      ],
      { stdio: "inherit" },
    );
    extracted = r.status === 0;
  } else {
    const r = spawnSync("unzip", ["-o", zipPath, "-d", tmp], { stdio: "inherit" });
    extracted = r.status === 0;
  }
  if (!extracted) {
    throw new Error("Failed to extract zip archive");
  }
  const found = findBinary(tmp, isWindows ? "veriumd.exe" : "veriumd");
  if (!found) {
    throw new Error("Could not find veriumd inside extracted archive");
  }
  fs.copyFileSync(found, destPath);
  if (!isWindows) fs.chmodSync(destPath, 0o755);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function extractTarGz(tarBuffer, destPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "veriumd-fetch-"));
  const tarPath = path.join(tmp, "archive.tar");
  fs.writeFileSync(tarPath, zlib.gunzipSync(tarBuffer));
  const r = spawnSync("tar", ["-xf", tarPath, "-C", tmp], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("Failed to extract tar.gz archive");
  const found = findBinary(tmp, "veriumd");
  if (!found) throw new Error("Could not find veriumd inside extracted archive");
  fs.copyFileSync(found, destPath);
  fs.chmodSync(destPath, 0o755);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function findBinary(dir, name) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = findBinary(full, name);
      if (r) return r;
    } else if (e.name === name || e.name.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return null;
}

async function main() {
  const triple = detectTargetTriple();
  const dest = sidecarPath(triple);
  ensureBinariesDir();

  if (fs.existsSync(dest) && process.env.VERIUMD_FORCE !== "1") {
    if (isStubSidecar(dest)) {
      log(`Removing stub sidecar at ${dest} (too small to be a real binary).`);
      fs.unlinkSync(dest);
    } else if (process.env.VERIUMD_SKIP_IF_PRESENT === "1" || args["skip-if-present"]) {
      log(`Sidecar already present (${dest}); skipping.`);
      return;
    } else {
      log(`Overwriting existing sidecar at ${dest} (set VERIUMD_FORCE=0 to skip).`);
    }
  }

  // Path 0: stub mode — write a placeholder so `cargo check` / `tauri build`
  // can validate the manifest in environments without network access. Real
  // builds must use a real binary; the stub is too small to actually run.
  if (process.env.VERIUMD_STUB === "1" || args.stub) {
    const banner = isWindowsTriple(triple)
      ? Buffer.from("MZ\x00\x00stub veriumd — fetch-veriumd --stub\n")
      : Buffer.from("#!/bin/sh\necho 'stub veriumd' >&2\nexit 1\n");
    fs.writeFileSync(dest, banner);
    if (!isWindowsTriple(triple)) fs.chmodSync(dest, 0o755);
    log(`Wrote stub sidecar at ${dest}`);
    return;
  }

  // Path 1: local copy
  const local = process.env.VERIUMD_LOCAL || args.local;
  if (local) {
    copyLocalBinary(local, dest);
    log(`Installed local veriumd as ${path.basename(dest)}`);
    return;
  }

  // Path 2: download archive from CDN (try known filenames until one works)
  const version = defaultVersion();
  const urls = archiveUrlsFor(triple, version);
  let lastErr;
  for (const url of urls) {
    try {
      log(`Downloading ${url}`);
      const buf = await fetchToBuffer(url);
      if (url.endsWith(".zip")) {
        extractZip(buf, dest, isWindowsTriple(triple));
      } else if (url.endsWith(".tar.gz") || url.endsWith(".tgz")) {
        extractTarGz(buf, dest);
      } else {
        fs.writeFileSync(dest, buf);
        if (!isWindowsTriple(triple)) fs.chmodSync(dest, 0o755);
      }
      log(`Sidecar installed: ${dest}`);
      return;
    } catch (e) {
      lastErr = e;
      log(`Failed: ${e.message}`);
    }
  }
  throw lastErr ?? new Error("No veriumd download URL succeeded");
}

main().catch((e) => {
  process.stderr.write(`[fetch-veriumd] ERROR: ${e.message}\n`);
  if (process.env.VERIUMD_OPTIONAL === "1") {
    process.stderr.write(
      "[fetch-veriumd] VERIUMD_OPTIONAL=1 set, continuing without sidecar.\n",
    );
    process.exit(0);
  }
  process.exit(1);
});
