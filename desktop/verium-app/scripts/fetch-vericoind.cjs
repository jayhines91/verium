#!/usr/bin/env node
/**
 * Fetch the platform-matched `vericoind` binary and place it under
 * `src-tauri/binaries/vericoind-<target-triple>{.exe}` for Tauri sidecar bundling.
 *
 * Usage mirrors scripts/fetch-veriumd.cjs with VERICOIND_* env vars.
 *
 * Set DACE_DEV=1 to prefer a monorepo build (vericoin/src/vericoind) — required
 * for the binarytest (DACE) network, which production CDN binaries do not yet
 * support.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const os = require("node:os");
const https = require("node:https");
const http = require("node:http");
const zlib = require("node:zlib");

const ROOT = path.resolve(__dirname, "..");
const BINARIES_DIR = path.join(ROOT, "src-tauri", "binaries");
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
  process.stdout.write(`[fetch-vericoind] ${msg}\n`);
}

function detectTargetTriple() {
  if (process.env.VERICOIND_TARGET_TRIPLE) return process.env.VERICOIND_TARGET_TRIPLE;
  if (args.triple) return args.triple;
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const m = out.match(/^host:\s*(\S+)/m);
    if (m) return m[1];
  } catch (e) {
    log(`rustc not on PATH; falling back (${e.message})`);
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
      throw new Error(`Unsupported host: ${process.platform}-${process.arch}`);
  }
}

function isWindowsTriple(t) {
  return t.includes("windows");
}

function isMacTriple(t) {
  return t.includes("apple-darwin");
}

function defaultVersion() {
  return process.env.VERICOIND_VERSION || args.version || "2.0.1";
}

function archiveUrlsFor(triple, version) {
  if (process.env.VERICOIND_DOWNLOAD_URL) return [process.env.VERICOIND_DOWNLOAD_URL];
  const baseRoot =
    process.env.VERICOIND_DOWNLOAD_BASE ||
    "https://files.vericonomy.com/vrc/releases/";
  const v = version ?? "2.0.1";
  const vBase = `${baseRoot}${v}/`;

  if (isWindowsTriple(triple)) {
    return [
      `${vBase}vericoin-x86_64-w64.zip`,
      `${vBase}vericoin-${v}-x86_64-w64.zip`,
    ];
  }
  if (isMacTriple(triple)) {
    return [`${vBase}vericoin-${v}-macos-intel.tar.gz`];
  }
  if (triple.includes("aarch64") && triple.includes("linux")) {
    return [`${vBase}vericoin-${v}-aarch64-linux-gnu.tar.gz`];
  }
  return [`${vBase}vericoin-${v}-x86_64-pc-linux-gnu.tar.gz`];
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
  return path.join(BINARIES_DIR, `vericoind-${triple}${ext}`);
}

async function fetchToBuffer(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https://") ? https : http;
    const req = client.get(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        if (redirectsLeft <= 0) return reject(new Error(`Too many redirects (${url})`));
        res.resume();
        return resolve(fetchToBuffer(res.headers.location, redirectsLeft - 1));
      }
      if (status !== 200) {
        return reject(new Error(`HTTP ${status} fetching ${url}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

function copyLocalBinary(localPath, destPath) {
  if (!fs.existsSync(localPath)) {
    throw new Error(`VERICOIND_LOCAL points at missing file: ${localPath}`);
  }
  fs.copyFileSync(localPath, destPath);
  if (process.platform !== "win32") fs.chmodSync(destPath, 0o755);
  log(`copied ${localPath} -> ${destPath}`);
  warnIfNotDace("vericoind", destPath);
}

function findBinary(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
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

function extractZip(zipBuffer, destPath, isWindows) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vericoind-fetch-"));
  const zipPath = path.join(tmp, "archive.zip");
  fs.writeFileSync(zipPath, zipBuffer);
  if (process.platform === "win32") {
    spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmp}' -Force`,
      ],
      { stdio: "inherit" },
    );
  } else {
    spawnSync("unzip", ["-o", zipPath, "-d", tmp], { stdio: "inherit" });
  }
  const found = findBinary(tmp, isWindows ? "vericoind.exe" : "vericoind");
  if (!found) throw new Error("Could not find vericoind inside archive");
  fs.copyFileSync(found, destPath);
  if (!isWindows) fs.chmodSync(destPath, 0o755);
  fs.rmSync(tmp, { recursive: true, force: true });
}

function extractTarGz(tarBuffer, destPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vericoind-fetch-"));
  const tarPath = path.join(tmp, "archive.tar");
  fs.writeFileSync(tarPath, zlib.gunzipSync(tarBuffer));
  spawnSync("tar", ["-xf", tarPath, "-C", tmp], { stdio: "inherit" });
  const found = findBinary(tmp, "vericoind");
  if (!found) throw new Error("Could not find vericoind inside archive");
  fs.copyFileSync(found, destPath);
  fs.chmodSync(destPath, 0o755);
  fs.rmSync(tmp, { recursive: true, force: true });
}

function writeStubSidecar(dest, triple) {
  const banner = isWindowsTriple(triple)
    ? Buffer.from("MZ\x00\x00stub vericoind\n")
    : Buffer.from("#!/bin/sh\necho 'stub vericoind' >&2\nexit 1\n");
  fs.writeFileSync(dest, banner);
  if (!isWindowsTriple(triple)) fs.chmodSync(dest, 0o755);
  log(`Wrote build placeholder stub at ${dest}`);
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

function discoverMonorepoBinary(isWindows) {
  const name = isWindows ? "vericoind.exe" : "vericoind";
  const candidates = [
    path.join(ROOT, "..", "..", "..", "vericoin", "src", name),
    path.join(ROOT, "..", "..", "..", "vericoin", "src", "qt", name),
    path.join(ROOT, "..", "..", "..", "vericoin", "build_msvc", "x64", "Release", name),
  ];
  for (const candidate of candidates) {
    if (isRealBinary(candidate)) return candidate;
  }
  return null;
}

/** Legacy Vericoin-Qt installer ships vericoind under Program Files. */
function discoverLegacyInstallBinary(isWindows) {
  if (!isWindows) return null;
  const name = "vericoind.exe";
  const roots = [
    process.env["ProgramFiles"],
    process.env["ProgramFiles(x86)"],
    "C:\\Program Files",
    "C:\\Program Files (x86)",
  ].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    candidates.push(path.join(root, "Vericoin", "daemon", name));
    candidates.push(path.join(root, "Vericoin", name));
  }
  for (const candidate of candidates) {
    if (isRealBinary(candidate)) return candidate;
  }
  return null;
}

function discoverLocalBinary(isWindows) {
  return discoverMonorepoBinary(isWindows) || discoverLegacyInstallBinary(isWindows);
}

async function main() {
  const triple = detectTargetTriple();
  const dest = sidecarPath(triple);
  fs.mkdirSync(BINARIES_DIR, { recursive: true });

  if (fs.existsSync(dest) && process.env.VERICOIND_FORCE !== "1") {
    if (process.env.VERICOIND_SKIP_IF_PRESENT === "1" || args["skip-if-present"]) {
      if (isStubSidecar(dest)) {
        const upgrade = discoverLocalBinary(isWindowsTriple(triple));
        if (upgrade) {
          log(`Replacing build placeholder with local binary at ${upgrade}`);
          copyLocalBinary(upgrade, dest);
          return;
        }
        log(
          `Build placeholder present (${dest}); skipping. ` +
            "Vericoin stays offline until CDN packages ship, a legacy Vericoin install is found, or you set VERICOIND_LOCAL.",
        );
      } else {
        log(`Sidecar already present (${dest}); skipping.`);
      }
      return;
    }
    if (!isStubSidecar(dest)) {
      log(`Sidecar already present (${dest}); skipping.`);
      return;
    }
    log(`Replacing build placeholder at ${dest} — retrying download.`);
    fs.unlinkSync(dest);
  }

  if (process.env.VERICOIND_STUB === "1" || args.stub) {
    writeStubSidecar(dest, triple);
    return;
  }

  const explicitLocal = process.env.VERICOIND_LOCAL || args.local;
  if (explicitLocal) {
    copyLocalBinary(explicitLocal, dest);
    return;
  }

  // DACE_DEV — strongly prefer the monorepo build (DACE-capable) over CDN/legacy
  // installs. Without DACE_DEV we still fall through to monorepo discovery as a
  // last resort because the CDN does not always have vericoind.
  if (process.env.DACE_DEV === "1" || args["dace-dev"]) {
    const monorepo = discoverMonorepoBinary(isWindowsTriple(triple));
    if (monorepo) {
      log(`DACE_DEV: using monorepo build at ${monorepo}`);
      copyLocalBinary(monorepo, dest);
      return;
    }
    log(
      "DACE_DEV=1 set but no monorepo vericoind found. Build with: " +
        "cd vericoin && ./autogen.sh && ./configure --enable-vericoin --without-gui && make",
    );
  }

  const local = discoverLocalBinary(isWindowsTriple(triple));
  if (local) {
    log(`Using local build at ${local}`);
    copyLocalBinary(local, dest);
    return;
  }

  const version = defaultVersion();
  const urls = archiveUrlsFor(triple, version);
  let lastErr;
  for (const url of urls) {
    try {
      log(`Downloading ${url}`);
      const buf = await fetchToBuffer(url);
      if (url.endsWith(".zip")) {
        extractZip(buf, dest, isWindowsTriple(triple));
      } else {
        extractTarGz(buf, dest);
      }
      log(`Sidecar installed: ${dest}`);
      return;
    } catch (e) {
      lastErr = e;
      log(`Failed: ${e.message}`);
    }
  }
  const required = process.env.VERICOIND_REQUIRED === "1";
  if (required) {
    throw lastErr ?? new Error("No vericoind download URL succeeded");
  }

  log(
    "No CDN vericoind available yet — writing a build placeholder so Tauri can compile. " +
      "Set VERICOIND_LOCAL to a built vericoind, or disable Vericoin in Settings until CDN packages ship.",
  );
  writeStubSidecar(dest, triple);
}

main().catch((e) => {
  process.stderr.write(`[fetch-vericoind] ERROR: ${e.message}\n`);
  process.exit(1);
});
