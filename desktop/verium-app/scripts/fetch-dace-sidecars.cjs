#!/usr/bin/env node
/**
 * fetch-dace-sidecars.cjs — install DACE-capable veriumd + vericoind sidecars
 * built from the unified vericoin/ tree.
 *
 * The production CDN sidecars do not include DACE / binarytest support, so
 * running the Vericonomy wallet against the binarytest (DACE) network
 * requires locally-built binaries. This script wraps fetch-veriumd.cjs and
 * fetch-vericoind.cjs with DACE_DEV=1 and VERIUMD_FORCE / VERICOIND_FORCE so
 * the existing CDN-installed sidecars are replaced.
 *
 * Build prerequisite (run once, or whenever the daemons change):
 *
 *   cd vericoin
 *   ./build-dace.ps1        # Windows + WSL
 *   ./build-dace.sh         # Linux / macOS / WSL directly
 *
 * Then from this directory:
 *
 *   npm run fetch:sidecars:dace
 */

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function run(label, args) {
  process.stdout.write(`[fetch-dace-sidecars] ${label}\n`);
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, DACE_DEV: "1" },
  });
  if (r.status !== 0) {
    process.stderr.write(`[fetch-dace-sidecars] ${label} failed (exit ${r.status}).\n`);
    process.exit(r.status ?? 1);
  }
}

process.env.VERIUMD_FORCE = process.env.VERIUMD_FORCE ?? "1";
process.env.VERICOIND_FORCE = process.env.VERICOIND_FORCE ?? "1";

run("installing DACE veriumd", [path.join("scripts", "fetch-veriumd.cjs")]);
run("installing DACE vericoind", [path.join("scripts", "fetch-vericoind.cjs")]);

process.stdout.write(
  "[fetch-dace-sidecars] Done. Restart the wallet to pick up the new sidecars.\n",
);
