#!/bin/bash
# Package a Windows NSIS installer for the Developer Edition build.
#
# Uses unstripped binaries from out-windows-dev/ (better for local debugging).
# Default install dir: Program Files\Verium Developer Edition
#
# Usage:
#   ./Build-Scripts/package-windows-dev-installer.sh
#   ./Build-Scripts/package-windows-dev-installer.sh /path/to/repo
#
# Requires: makensis, dev binaries in out-windows-dev/, ENABLE_DEV_HELPER_WINDOW=1
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
BINARY_DIR="${BINARY_DIR:-${ROOT}/out-windows-dev}"
STAGING_DIR="${STAGING_DIR:-${ROOT}/installer-windows-dev/staging}"
OUT_DIR="${OUT_DIR:-${ROOT}/out-windows-dev}"
NSI_TEMPLATE="${ROOT}/share/setup-dev.nsi.in"
NSI_GENERATED="${ROOT}/installer-windows-dev/setup-dev.nsi"

if ! grep -q '^#define ENABLE_DEV_HELPER_WINDOW 1' "${ROOT}/src/util/devhelperconfig.h" 2>/dev/null; then
  echo "ERROR: Developer Edition packaging requires ENABLE_DEV_HELPER_WINDOW 1 in src/util/devhelperconfig.h" >&2
  exit 1
fi

read_version_from_configure() {
  local cfg="${ROOT}/configure.ac"
  local major minor revision build
  major=$(sed -n 's/^define(_CLIENT_VERSION_MAJOR, //p' "$cfg" | tr -d ' )')
  minor=$(sed -n 's/^define(_CLIENT_VERSION_MINOR, //p' "$cfg" | tr -d ' )')
  revision=$(sed -n 's/^define(_CLIENT_VERSION_REVISION, //p' "$cfg" | tr -d ' )')
  build=$(sed -n 's/^define(_CLIENT_VERSION_BUILD, //p' "$cfg" | tr -d ' )')
  if [ -z "$major" ] || [ -z "$minor" ] || [ -z "$revision" ]; then
    echo "ERROR: could not read version from ${cfg}" >&2
    exit 1
  fi
  if [ -n "$build" ] && [ "$build" != "0" ]; then
    echo "${major}.${minor}.${revision}.${build}"
  else
    echo "${major}.${minor}.${revision}"
  fi
}

VERSION="$(read_version_from_configure)"
VERSION_QUAD="$(echo "$VERSION" | awk -F. '{printf "%s.%s.%s.%s", $1, $2, $3, ($4==""?0:$4)}')"
COPYRIGHT_YEAR="$(date +%Y)"
INSTALLER_NAME="Verium-${VERSION}-DeveloperEdition-win64-setup-unsigned.exe"
INSTALLER_PATH="${OUT_DIR}/${INSTALLER_NAME}"

REQUIRED_BINARIES=(
  verium-qt.exe
  veriumd.exe
  verium-cli.exe
  verium-tx.exe
  verium-wallet.exe
)

for bin in "${REQUIRED_BINARIES[@]}"; do
  if [ ! -f "${BINARY_DIR}/${bin}" ]; then
    echo "ERROR: missing ${BINARY_DIR}/${bin}" >&2
    echo "       Run Build-Scripts/build-windows-dev-docker.sh (or recompile-dev-windows.sh) first." >&2
    exit 1
  fi
done

if ! command -v makensis >/dev/null 2>&1; then
  echo "ERROR: makensis not found (install NSIS)" >&2
  exit 1
fi

mkdir -p "$STAGING_DIR" "$OUT_DIR" "$(dirname "$NSI_GENERATED")"

cat > "${STAGING_DIR}/DEV_EDITION_windows.txt" <<EOF
Verium Developer Edition — local debugging build
Version: ${VERSION}
NOT for distribution to coin holders.

Install location
----------------
Program Files\\Verium Developer Edition

This installer is separate from the public release build. It installs to its
own directory, Start Menu folder, and uninstall registry entry so it will not
overwrite a normal Verium installation.

Binaries included
-----------------
verium-qt.exe          GUI wallet (Developer Edition splash and tools)
daemon\\veriumd.exe    Headless node
daemon\\verium-cli.exe RPC client
daemon\\verium-tx.exe  Transaction utility
daemon\\verium-wallet.exe  Wallet tool

Developer tools
---------------
On first launch you are prompted once per session to open the Verbose Dev Trace
window before chain load and bootstrap. Default master password: VeriDev225!

If you decline the trace window, dev tools stay unavailable until restart.
activity.log in the wallet data directory is still written during init.

Build flag
----------
Compiled with ENABLE_DEV_HELPER_WINDOW=1 in src/util/devhelperconfig.h
EOF

# NSIS File paths must use forward slashes even on Windows cross-build hosts.
ROOT_NSI="${ROOT//\\//}"
BINARY_DIR_NSI="${BINARY_DIR//\\//}"
STAGING_DIR_NSI="${STAGING_DIR//\\//}"
OUTFILE_NSI="${INSTALLER_PATH//\\//}"

sed \
  -e "s|@ROOT@|${ROOT_NSI}|g" \
  -e "s|@BINARY_DIR@|${BINARY_DIR_NSI}|g" \
  -e "s|@STAGING_DIR@|${STAGING_DIR_NSI}|g" \
  -e "s|@OUTFILE@|${OUTFILE_NSI}|g" \
  -e "s|@VERSION@|${VERSION}|g" \
  -e "s|@VERSION_QUAD@|${VERSION_QUAD}|g" \
  -e "s|@COPYRIGHT_YEAR@|${COPYRIGHT_YEAR}|g" \
  "$NSI_TEMPLATE" > "$NSI_GENERATED"

echo "=== Building Developer Edition Windows installer ==="
echo "Binaries: ${BINARY_DIR}"
echo "Output:   ${INSTALLER_PATH}"
makensis -V2 "$NSI_GENERATED"

ls -lh "$INSTALLER_PATH"
echo "=== Developer Edition installer ready ==="
