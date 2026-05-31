#!/usr/bin/env node
/**
 * Fail (or warn) when Tauri sidecars are build placeholders instead of real daemons.
 * Used before release bundles so the DMG/AppImage does not ship stub vericoind.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const BINARIES_DIR = path.join(ROOT, "src-tauri", "binaries");
const MIN_BYTES = 100_000;
const args = new Set(process.argv.slice(2));
const warnOnly = args.has("--warn-only");

function log(msg) {
  process.stdout.write(`[assert-sidecars] ${msg}\n`);
}

function detectTriple() {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE;
  if (process.env.VERICOIND_TARGET_TRIPLE) return process.env.VERICOIND_TARGET_TRIPLE;
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const m = out.match(/^host:\s*(\S+)/m);
    if (m) return m[1];
  } catch {
    /* ignore */
  }
  switch (`${process.platform}-${process.arch}`) {
    case "darwin-arm64":
      return "aarch64-apple-darwin";
    case "darwin-x64":
      return "x86_64-apple-darwin";
    case "win32-x64":
      return "x86_64-pc-windows-msvc";
    case "linux-x64":
      return "x86_64-unknown-linux-gnu";
    case "linux-arm64":
      return "aarch64-unknown-linux-gnu";
    default:
      return `${process.arch}-${process.platform}`;
  }
}

function sidecarPath(base, triple) {
  const ext = triple.includes("windows") ? ".exe" : "";
  return path.join(BINARIES_DIR, `${base}-${triple}${ext}`);
}

function check(name) {
  const triple = detectTriple();
  const file = sidecarPath(name, triple);
  if (!fs.existsSync(file)) {
    return { ok: false, file, reason: "missing" };
  }
  const size = fs.statSync(file).size;
  if (size < MIN_BYTES) {
    return { ok: false, file, reason: "stub", size };
  }
  return { ok: true, file, size };
}

function main() {
  const coins = [
    { name: "veriumd", hint: "npm run build:veriumd:macos  or  VERIUMD_LOCAL=... npm run fetch:veriumd" },
    {
      name: "vericoind",
      hint:
        "Clone/build vericoin (see scripts/build-vericoind-macos.sh), then " +
        "VERICOIND_LOCAL=/path/to/vericoind npm run fetch:vericoind",
    },
  ];
  let failed = false;
  for (const { name, hint } of coins) {
    const r = check(name);
    if (r.ok) {
      log(`OK ${name} (${(r.size / 1_000_000).toFixed(1)} MB) at ${r.file}`);
      continue;
    }
    const msg =
      r.reason === "stub"
        ? `${name} is a build placeholder (${r.size} bytes) at ${r.file}. Vericoin/VRC will not run until you install a real binary. ${hint}`
        : `${name} sidecar missing at ${r.file}. ${hint}`;
    if (warnOnly) {
      log(`WARN ${msg}`);
    } else {
      process.stderr.write(`[assert-sidecars] ERROR: ${msg}\n`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

main();
