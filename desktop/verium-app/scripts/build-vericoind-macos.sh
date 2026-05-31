#!/usr/bin/env bash
# Build vericoind on Apple Silicon and install it as the Tauri sidecar.
#
# Prerequisite: clone the Vericoin sources next to this repo, e.g.
#   cd ~/Documents/GitHub/repkey-functions
#   git clone https://github.com/VeriConomy/vericoin.git vericoin
#
# Usage:
#   ./scripts/build-vericoind-macos.sh
#   VERICOIN_ROOT=/path/to/vericoin ./scripts/build-vericoind-macos.sh
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERICOIN_ROOT="${VERICOIN_ROOT:-$(cd "$APP_ROOT/../../vericoin" 2>/dev/null && pwd || true)}"
TARGET_TRIPLE="${VERICOIND_TARGET_TRIPLE:-aarch64-apple-darwin}"

if [[ -z "$VERICOIN_ROOT" || ! -d "$VERICOIN_ROOT" ]]; then
  echo "Vericoin source tree not found."
  echo "Clone it, then re-run:"
  echo "  git clone https://github.com/VeriConomy/vericoin.git \"$(cd "$APP_ROOT/../.." && pwd)/vericoin\""
  echo "  VERICOIN_ROOT=/path/to/vericoin $0"
  exit 1
fi

echo "==> Vericoin source: $VERICOIN_ROOT"
cd "$VERICOIN_ROOT"

if [[ ! -f configure ]]; then
  ./autogen.sh
fi

B="$(brew --prefix boost@1.85 2>/dev/null || true)"
if [[ -z "$B" ]]; then
  echo "Install boost@1.85: brew install boost@1.85"
  exit 1
fi

for pkg in openssl@3 berkeley-db@4 minizip zeromq libevent miniupnpc; do
  if ! brew list "$pkg" &>/dev/null; then
    echo "Installing $pkg..."
    brew install "$pkg"
  fi
done

M="$(brew --prefix minizip)"
Z="$(brew --prefix zeromq)"
E="$(brew --prefix libevent)"
export BOOST_ROOT="$B"
export LDFLAGS="-L$(brew --prefix openssl@3)/lib -L$(brew --prefix berkeley-db@4)/lib -L$B/lib -L$M/lib -L$Z/lib -L$E/lib"
export CPPFLAGS="-I$(brew --prefix openssl@3)/include -I$(brew --prefix berkeley-db@4)/include -I$B/include -I$M/include -I$Z/include -I$E/include"

./configure --without-gui --disable-tests --disable-bench --with-boost="$B" --with-boost-libdir="$B/lib"
make -j"$(sysctl -n hw.ncpu)" src/vericoind

echo "==> Built $(file -b src/vericoind)"
cd "$APP_ROOT"
VERICOIND_LOCAL="$VERICOIN_ROOT/src/vericoind" VERICOIND_TARGET_TRIPLE="$TARGET_TRIPLE" VERICOIND_FORCE=1 npm run fetch:vericoind
echo "==> Sidecar ready at src-tauri/binaries/vericoind-${TARGET_TRIPLE}"
