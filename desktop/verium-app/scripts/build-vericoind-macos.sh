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
VERIUM_ROOT="$(cd "$APP_ROOT/../.." && pwd)"
DEFAULT_VERICOIN_ROOT="$VERIUM_ROOT/vericoin"
VERICOIN_ROOT="${VERICOIN_ROOT:-$DEFAULT_VERICOIN_ROOT}"
VERICOIN_REPO="${VERICOIN_GIT_URL:-https://github.com/VeriConomy/vericoin.git}"
VERICOIN_REF="${VERICOIN_GIT_REF:-master}"
TARGET_TRIPLE="${VERICOIND_TARGET_TRIPLE:-aarch64-apple-darwin}"

if [[ ! -d "$VERICOIN_ROOT/.git" ]]; then
  echo "==> Cloning Vericoin ($VERICOIN_REF) into $VERICOIN_ROOT"
  git clone --depth 1 --branch "$VERICOIN_REF" "$VERICOIN_REPO" "$VERICOIN_ROOT"
fi

echo "==> Vericoin source: $VERICOIN_ROOT"
cd "$VERICOIN_ROOT"

# Homebrew boost@1.85+ API changes (copy_options, depth()).
patch_boost_185_compat() {
  local db_cpp="src/wallet/db.cpp"
  if [[ -f "$db_cpp" ]] && grep -q 'copy_option::overwrite_if_exists' "$db_cpp"; then
    sed -i '' 's/fs::copy_option::overwrite_if_exists/fs::copy_options::overwrite_existing/g' "$db_cpp"
    echo "==> Patched $db_cpp for Boost 1.85+"
  fi
  local util_cpp="src/wallet/walletutil.cpp"
  if [[ -f "$util_cpp" ]] && grep -q 'it\.level()' "$util_cpp"; then
    sed -i '' 's/it\.level()/it.depth()/g' "$util_cpp"
    echo "==> Patched $util_cpp for Boost 1.85+"
  fi
}
patch_boost_185_compat

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

# crc32c enables weak getauxval on clang, but macOS does not provide the symbol.
fix_darwin_crc32c() {
  local mk="$VERICOIN_ROOT/src/Makefile"
  [[ -f "$mk" ]] || return 0
  sed -i '' \
    -e 's/-DHAVE_WEAK_GETAUXVAL=1/-DHAVE_WEAK_GETAUXVAL=0/g' \
    -e 's/-DHAVE_STRONG_GETAUXVAL=1/-DHAVE_STRONG_GETAUXVAL=0/g' \
    -e 's/-DHAVE_ARM64_CRC32C=1/-DHAVE_ARM64_CRC32C=0/g' \
    "$mk"
  find "$VERICOIN_ROOT/src/crc32c" \( -name '*.o' -o -name '*.a' \) -delete 2>/dev/null || true
  echo "==> Disabled Linux getauxval ARM CRC path for macOS link"
}
fix_darwin_crc32c

make -j"$(sysctl -n hw.ncpu)" src/vericoind

echo "==> Built $(file -b src/vericoind)"
cd "$APP_ROOT"
VERICOIND_LOCAL="$VERICOIN_ROOT/src/vericoind" VERICOIND_TARGET_TRIPLE="$TARGET_TRIPLE" VERICOIND_FORCE=1 npm run fetch:vericoind
echo "==> Sidecar ready at src-tauri/binaries/vericoind-${TARGET_TRIPLE}"
