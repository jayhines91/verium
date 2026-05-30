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
 *   DACE_DEV=1 node scripts/fetch-veriumd.cjs   # prefer monorepo build (for binarytest/DACE)
 *
 * Environment:
 *   VERIUMD_DOWNLOAD_BASE  Override base URL (default: files.vericonomy.com/vrm/releases/)
 *   VERIUMD_VERSION        Version to fetch (default: latest from releases-manifest.json)
 *   VERIUMD_LOCAL          Path to an already-built veriumd to copy instead of download
 *   VERIUMD_SKIP_IF_PRESENT=1  Exit success if the sidecar already exists
 *   VERIUMD_FORCE=1        Overwrite existing sidecar
 *   VERIUMD_TARGET_TRIPLE  Explicit Rust target triple (overrides auto-detect)
 *   DACE_DEV=1             Prefer a monorepo build (vericoin/src/veriumd) over CDN — required for
 *                          the binarytest (DACE) network, which the production CDN binaries do not
 *                          yet support.
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
    // macOS ships separate native builds per architecture when available.
    // CDN often has Intel-only packages; Apple Silicon builds fall back to
    // the Intel binary (runs under Rosetta on arm64 Macs).
    if (triple.includes("aarch64")) {
      return [
        `${vBase}verium-${v}-macos-arm64.tar.gz`,
        `${vBase}verium-${v}-aarch64-apple-darwin.tar.gz`,
        `${vBase}verium-${v}-macos-intel.tar.gz`,
        `${vBase}verium-${v}-x86_64-apple-darwin.tar.gz`,
        `${legacy}verium-1.3.5-x86_64-apple-darwin.zip`,
      ];
    }
    return [
      `${vBase}verium-${v}-macos-intel.tar.gz`,
      `${vBase}verium-${v}-x86_64-apple-darwin.tar.gz`,
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

function detectX86SimdSuffix() {
  if (process.arch !== "x64") return "";
  try {
    if (process.platform === "linux") {
      const info = fs.readFileSync("/proc/cpuinfo", "utf8");
      if (/avx512f/.test(info)) return "-avx512";
      if (/avx2/.test(info)) return "-avx2";
    }
    if (process.platform === "win32") {
      return "-avx2";
    }
    if (process.platform === "darwin") {
      return "";
    }
  } catch {
    /* ignore */
  }
  return "";
}

function sidecarPath(triple) {
  const ext = isWindowsTriple(triple) ? ".exe" : "";
  const suffix = detectX86SimdSuffix();
  const suffixed = path.join(BINARIES_DIR, `veriumd-${triple}${suffix}${ext}`);
  if (suffix && fs.existsSync(suffixed)) return suffixed;
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
  assertLegacyFlatVeriumd(destPath);
  log(`copied ${localPath} -> ${destPath}`);
  warnIfNotDace("veriumd", destPath);
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
  assertLegacyFlatVeriumd(destPath);
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
  assertLegacyFlatVeriumd(destPath);
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

function supportsUnifiedVerium(binaryPath) {
  if (!fs.existsSync(binaryPath)) return false;
  try {
    const r = spawnSync(binaryPath, ["-help"], { encoding: "utf8", timeout: 15000 });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    return out.includes("-verium");
  } catch {
    return false;
  }
}

function assertLegacyFlatVeriumd(destPath) {
  if (supportsUnifiedVerium(destPath)) {
    throw new Error(
      `Refusing to install unified vericoin/veriumd as the Verium mainnet sidecar (${destPath}). ` +
        "Verium mainnet requires the legacy flat-layout verium-only binary (no -verium flag). " +
        "Set VERIUMD_LOCAL to a verium-only build from verium-legacy/ or verium v1.x.",
    );
  }
}

function supportsBinarytest(binaryPath) {
  if (!fs.existsSync(binaryPath)) return false;
  try {
    const r = spawnSync(binaryPath, ["-help"], { encoding: "utf8", timeout: 15000 });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    return out.includes("-binarytest");
  } catch {
    return false;
  }
}

function warnIfNotDace(label, destPath) {
  if (process.env.DACE_DEV === "1" && !supportsBinarytest(destPath)) {
    log(
      `WARNING: ${label} at ${destPath} does not advertise -binarytest. ` +
        "Binarytest mode will not work until you build from vericoin/ (see build-dace.ps1).",
    );
  }
}

function isRealBinary(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).size >= MIN_REAL_BINARY_BYTES;
  } catch {
    return false;
  }
}

/** True when an aarch64 sidecar path contains an x86_64 Mach-O binary (stale Intel fetch). */
function sidecarArchMismatch(dest, triple) {
  if (!triple.includes("aarch64") || !triple.includes("apple-darwin")) return false;
  if (!fs.existsSync(dest)) return false;
  try {
    const r = spawnSync("file", ["-b", dest], { encoding: "utf8" });
    const desc = (r.stdout || "").toLowerCase();
    return desc.includes("x86_64") && !desc.includes("arm64");
  } catch {
    return false;
  }
}

/** Look for a locally-built veriumd inside the monorepo. The DACE-capable
 *  binary lives under vericoin/src/ (the unified tree builds both veriumd
 *  and vericoind via CLIENT_IS_VERIUM). */
function discoverMonorepoBinary(isWindows) {
  const name = isWindows ? "veriumd.exe" : "veriumd";
  const candidates = [
    path.join(ROOT, "..", "..", "..", "verium-legacy", "verium", "src", name),
    path.join(ROOT, "..", "..", "..", "verium-legacy", "verium", "src", "qt", name),
    path.join(ROOT, "..", "..", "..", "verium-legacy", "verium", "build_msvc", "x64", "Release", name),
    path.join(ROOT, "..", "..", "..", "verium", "src", name),
    path.join(ROOT, "..", "..", "..", "vericoin", "src", name),
    path.join(ROOT, "..", "..", "..", "vericoin", "src", "qt", name),
    path.join(ROOT, "..", "..", "..", "vericoin", "build_msvc", "x64", "Release", name),
    path.join(ROOT, "..", "..", "verium", "src", name),
  ];
  for (const candidate of candidates) {
    if (!isRealBinary(candidate)) continue;
    if (supportsUnifiedVerium(candidate)) continue;
    return candidate;
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
      if (sidecarArchMismatch(dest, triple)) {
        log(
          `Sidecar at ${dest} is Intel (x86_64) but target is ${triple}; re-fetching.`,
        );
      } else {
        log(`Sidecar already present (${dest}); skipping.`);
        return;
      }
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

  // Path 1: local copy (explicit override always wins)
  const explicitLocal = process.env.VERIUMD_LOCAL || args.local;
  if (explicitLocal) {
    copyLocalBinary(explicitLocal, dest);
    log(`Installed local veriumd as ${path.basename(dest)}`);
    return;
  }

  // Path 1b: monorepo build (src/veriumd after `make`) — preferred over CDN for
  // local dev so wallet features match the tree you are editing. Set
  // VERIUMD_CDN_ONLY=1 to force CDN download. CI release builds use artifacts
  // instead (see .github/workflows/desktop-app.yml).
  const preferMonorepo =
    process.env.VERIUMD_CDN_ONLY !== "1" &&
    (process.env.DACE_DEV === "1" ||
      args["dace-dev"] ||
      process.env.VERIUMD_USE_MONOREPO !== "0");
  if (preferMonorepo) {
    const monorepo = discoverMonorepoBinary(isWindowsTriple(triple));
    if (monorepo) {
      log(`Using monorepo veriumd at ${monorepo}`);
      copyLocalBinary(monorepo, dest);
      return;
    }
    if (process.env.DACE_DEV === "1" || args["dace-dev"]) {
      log(
        "DACE_DEV=1 set but no monorepo veriumd found. Build with: " +
          "./autogen.sh && make -C depends HOST=<triple> NO_QT=1 && ./configure --host=<triple> ... && make src/veriumd",
      );
    }
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
      assertLegacyFlatVeriumd(dest);
      log(`Sidecar installed: ${dest}`);
      if (triple.includes("aarch64") && sidecarArchMismatch(dest, triple)) {
        log(
          "NOTE: Installed Intel veriumd for Apple Silicon (CDN has no arm64 build). " +
            "It runs via Rosetta. For native arm64, set VERIUMD_LOCAL to a local build.",
        );
      }
      warnIfNotDace("veriumd", dest);
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
