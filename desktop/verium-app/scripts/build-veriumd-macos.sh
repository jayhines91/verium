#!/usr/bin/env bash
# Build native arm64 veriumd on Apple Silicon and install it as the Tauri sidecar.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERIUM_ROOT="$(cd "$APP_ROOT/../.." && pwd)"
TARGET_TRIPLE="${VERIUMD_TARGET_TRIPLE:-aarch64-apple-darwin}"

echo "==> Verium source: $VERIUM_ROOT"
cd "$VERIUM_ROOT"

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
make -j"$(sysctl -n hw.ncpu)" src/veriumd

echo "==> Built $(file -b src/veriumd)"
cd "$APP_ROOT"
VERIUMD_LOCAL="$VERIUM_ROOT/src/veriumd" VERIUMD_TARGET_TRIPLE="$TARGET_TRIPLE" npm run fetch:veriumd
echo "==> Sidecar ready at src-tauri/binaries/veriumd-${TARGET_TRIPLE}"
