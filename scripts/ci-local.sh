#!/usr/bin/env bash
# Mirror .github/workflows/desktop-app.yml locally (WSL / Linux / macOS).
#
# Examples:
#   ./scripts/ci-local.sh                                    # Linux x64 full pipeline
#   ./scripts/ci-local.sh --target aarch64-unknown-linux-gnu # cross-compile ARM sidecar
#   ./scripts/ci-local.sh --phase sidecar                    # veriumd only
#   ./scripts/ci-local.sh --phase sidecar --skip-depends     # reuse built depends/
#   ./scripts/ci-local.sh --phase wallet --skip-depends --skip-sidecar-build
#   ./scripts/ci-local.sh --install-deps                     # apt/brew packages first
#
set -euo pipefail

# WSL often inherits a Windows PATH with spaces/parentheses (e.g. "Program Files (x86)"),
# which breaks depends recipes that inline PATH=... without quotes.
if grep -qi microsoft /proc/version 2>/dev/null; then
  export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/desktop/verium-app"
OUT="$ROOT/out"

TARGET="x86_64-unknown-linux-gnu"
PHASE="all"
INSTALL_DEPS=0
SKIP_SIDECAR_BUILD=0
SKIP_DEPENDS=0
DEPS_ONLY=0
JOBS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"

usage() {
  sed -n '2,12p' "$0"
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --target) TARGET="$2"; shift 2 ;;
    --phase) PHASE="$2"; shift 2 ;;
    --jobs) JOBS="$2"; shift 2 ;;
    --install-deps) INSTALL_DEPS=1; shift ;;
    --skip-sidecar-build) SKIP_SIDECAR_BUILD=1; shift ;;
    --skip-depends) SKIP_DEPENDS=1; shift ;;
    --deps-only) DEPS_ONLY=1; shift ;;
    *) echo "Unknown option: $1" >&2; usage 1 ;;
  esac
done

case "$TARGET" in
  x86_64-unknown-linux-gnu)
    HOST="x86_64-linux-gnu"
    KIND="linux"
    CONFIGURE_EXTRA=""
    ;;
  aarch64-unknown-linux-gnu)
    HOST="aarch64-linux-gnu"
    KIND="linux"
    CONFIGURE_EXTRA="--enable-arm-crypto"
    ;;
  x86_64-apple-darwin)
    HOST="x86_64-apple-darwin"
    KIND="macos"
    CONFIGURE_EXTRA=""
    ;;
  aarch64-apple-darwin)
    HOST="aarch64-apple-darwin"
    KIND="macos"
    CONFIGURE_EXTRA="--enable-arm-crypto"
    ;;
  x86_64-pc-windows-msvc)
    HOST="x86_64-w64-mingw32"
    KIND="mingw"
    CONFIGURE_EXTRA=""
    ;;
  *)
    echo "Unsupported --target: $TARGET" >&2
    exit 1
    ;;
esac

log() { printf '\n=== %s ===\n' "$*"; }

need_sudo() {
  sudo -n true 2>/dev/null
}

require_sudo() {
  if ! need_sudo; then
    echo "ERROR: sudo password required for apt packages." >&2
    echo "Run once in WSL (enter your password):" >&2
    echo "  sudo apt-get update && sudo apt-get install -y build-essential libtool autotools-dev automake pkg-config bsdmainutils python3 curl ca-certificates" >&2
    if [[ "$HOST" == "aarch64-linux-gnu" && "$(uname -m)" != "aarch64" ]]; then
      echo "  sudo apt-get install -y gcc-aarch64-linux-gnu g++-aarch64-linux-gnu" >&2
    fi
    if [[ "$KIND" == "mingw" ]]; then
      echo "  sudo apt-get install -y g++-mingw-w64-x86-64 binutils-mingw-w64-x86-64" >&2
    fi
    if [[ "$KIND" == "linux" ]] && [[ "$PHASE" == "wallet" || "$PHASE" == "all" ]]; then
      echo "  sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev libgtk-3-dev libfuse2" >&2
    fi
    echo "Or re-run with --install-deps after configuring passwordless sudo." >&2
    exit 1
  fi
}

install_sidecar_deps() {
  require_sudo
  if [[ "$KIND" == "linux" || "$KIND" == "mingw" ]]; then
    sudo apt-get update
    sudo apt-get install -y \
      build-essential libtool autotools-dev automake pkg-config \
      bsdmainutils python3 curl ca-certificates
    if [[ "$HOST" == "aarch64-linux-gnu" && "$(uname -m)" != "aarch64" ]]; then
      sudo apt-get install -y gcc-aarch64-linux-gnu g++-aarch64-linux-gnu
    fi
  fi
  if [[ "$KIND" == "mingw" ]]; then
    sudo apt-get install -y g++-mingw-w64-x86-64 binutils-mingw-w64-x86-64
    sudo update-alternatives --set x86_64-w64-mingw32-gcc /usr/bin/x86_64-w64-mingw32-gcc-posix 2>/dev/null || true
    sudo update-alternatives --set x86_64-w64-mingw32-g++ /usr/bin/x86_64-w64-mingw32-g++-posix 2>/dev/null || true
  fi
  if [[ "$KIND" == "macos" ]]; then
    brew install automake libtool pkg-config
    python3 -m pip install --user --break-system-packages --upgrade pip setuptools wheel 2>/dev/null \
      || python3 -m pip install --user --upgrade pip setuptools wheel
  fi
}

install_wallet_deps_linux() {
  require_sudo
  sudo apt-get update
  sudo apt-get install -y \
    libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
    build-essential curl wget file libssl-dev libgtk-3-dev libfuse2 xdg-utils
}

install_node_rust_wsl() {
  if ! command -v node >/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
  if ! command -v cargo >/dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
  fi
  # shellcheck disable=SC1091
  [[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
}

prepare_depends_no_qt() {
  cd "$ROOT"
  find depends/work/build -type d -name qt -prune -exec rm -rf {} + 2>/dev/null || true
  rm -rf depends/work/staging/*/qt* depends/work/download/qt-* 2>/dev/null || true
  find depends/built -maxdepth 1 -name '*qt*' -exec rm -rf {} + 2>/dev/null || true
  if make -C depends HOST="$HOST" NO_QT=1 -pn 2>/dev/null | grep '^packages :=' | grep -qw qt; then
    echo "ERROR: qt is still in depends package list (NO_QT=1 not applied)" >&2
    exit 1
  fi
}

apply_mingw_gmtime_shim() {
  local f="$ROOT/src/util/time.cpp"
  if [[ -f "$f" ]] && ! grep -q 'gmtime_r_compat' "$f"; then
    {
      echo '#ifdef _WIN32'
      echo '#include <time.h>'
      echo 'static inline struct tm* gmtime_r_compat(const time_t* t, struct tm* res){ return gmtime_s(res,t)==0 ? res : NULL; }'
      echo '#define gmtime_r(t,r) gmtime_r_compat((t),(r))'
      echo '#endif'
      cat "$f"
    } > "$f.tmp" && mv "$f.tmp" "$f"
  fi
}

fix_windows_checkout() {
  cd "$ROOT"
  # Strip CRLF from autotools inputs (common on Windows checkouts).
  find . -type f \( \
    -name '*.sh' -o -name '*.ac' -o -name 'Makefile.am' -o -name '*.mk' \
    -o -name 'config.guess' -o -name 'config.sub' -o -name 'config.site.in' \
    -o -name '*.m4' -o -name 'configure.ac' \
  \) ! -path './depends/work/*' ! -path './depends/sources/*' ! -path './depends/built/*' \
    -exec grep -Iq . {} \; -exec sed -i 's/\r$//' {} + 2>/dev/null || true
  chmod +x autogen.sh depends/config.guess depends/config.sub 2>/dev/null || true
}

build_sidecar() {
  cd "$ROOT"
  fix_windows_checkout
  if [[ "$HOST" == "aarch64-linux-gnu" && "$(uname -m)" != "aarch64" ]] \
      && ! command -v aarch64-linux-gnu-g++ >/dev/null; then
    echo "ERROR: aarch64-linux-gnu-g++ not found. Install with:" >&2
    echo "  sudo apt-get install -y gcc-aarch64-linux-gnu g++-aarch64-linux-gnu" >&2
    exit 1
  fi
  if [[ "$KIND" == "mingw" ]] && ! command -v x86_64-w64-mingw32-g++ >/dev/null; then
    echo "ERROR: x86_64-w64-mingw32-g++ not found. Install with:" >&2
    echo "  sudo apt-get install -y g++-mingw-w64-x86-64 binutils-mingw-w64-x86-64" >&2
    exit 1
  fi
  log "Build depends (HOST=$HOST NO_QT=1)"
  if [[ "$SKIP_DEPENDS" == "0" ]]; then
  prepare_depends_no_qt
  local extra=""
  if [[ "$KIND" == "mingw" ]]; then
    apply_mingw_gmtime_shim
    extra="RC=${HOST}-windres WINDRES=${HOST}-windres CC_FOR_BUILD=gcc CXX_FOR_BUILD=g++"
  fi
  make -C depends HOST="$HOST" NO_QT=1 -j"$JOBS" $extra
  if find depends/work/build -type d -name qt 2>/dev/null | grep -q .; then
    echo "ERROR: Qt was built despite NO_QT=1" >&2
    find depends/work/build -type d -name qt
    exit 1
  fi
  else
    log "Skipping depends (already built)"
  fi

  log "Configure + build veriumd"
  ./autogen.sh
  export CONFIG_SITE="$ROOT/depends/$HOST/share/config.site"
  local mingw_flags=""
  if [[ "$KIND" == "mingw" ]]; then
    mingw_flags="ac_cv_search_clock_gettime=no"
  fi
  if [[ "$KIND" == "macos" ]]; then
    case "$HOST" in
      aarch64-*) export MACOSX_DEPLOYMENT_TARGET=11.0 ;;
      *)         export MACOSX_DEPLOYMENT_TARGET=10.15 ;;
    esac
  fi
  ./configure \
    --host="$HOST" \
    --prefix="$ROOT/depends/$HOST" \
    --without-gui --disable-tests --disable-bench \
    --enable-reduce-exports --disable-shared --enable-static \
    $CONFIGURE_EXTRA $mingw_flags \
  || { echo "=== config.log (tail) ==="; tail -n 150 config.log || true; exit 1; }

  if [[ "$KIND" == "mingw" ]]; then
    make -j"$JOBS" src/veriumd.exe
  else
    make -j"$JOBS" src/veriumd
    ./src/veriumd -version | head -n 3
  fi

  mkdir -p "$OUT"
  if [[ "$KIND" == "mingw" ]]; then
    cp src/veriumd.exe "$OUT/veriumd-$TARGET.exe"
  else
    cp src/veriumd "$OUT/veriumd-$TARGET"
    chmod +x "$OUT/veriumd-$TARGET"
  fi
  ls -la "$OUT"
}

stage_sidecar_for_wallet() {
  mkdir -p "$APP/src-tauri/binaries"
  if [[ "$KIND" == "mingw" ]]; then
    cp "$OUT/veriumd-$TARGET.exe" "$APP/src-tauri/binaries/veriumd-$TARGET.exe"
  else
    cp "$OUT/veriumd-$TARGET" "$APP/src-tauri/binaries/veriumd-$TARGET"
    chmod +x "$APP/src-tauri/binaries/veriumd-$TARGET"
  fi
}

build_wallet() {
  if [[ "$KIND" != "linux" ]]; then
    echo "Wallet build via this script is only wired for Linux (use native macOS/Windows for other targets)." >&2
    exit 1
  fi
  # shellcheck disable=SC1091
  [[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
  command -v node >/dev/null || { echo "node missing; run with --install-deps or install Node 20+" >&2; exit 1; }
  command -v cargo >/dev/null || { echo "cargo missing; run with --install-deps or install Rust stable" >&2; exit 1; }
  rustup target add "$TARGET" 2>/dev/null || true

  cd "$APP"
  log "npm install + lint + test + build"
  npm ci || npm install
  npm run lint
  npm test
  npm run build

  log "Stage sidecar for Tauri"
  stage_sidecar_for_wallet
  VERIUMD_TARGET_TRIPLE="$TARGET" VERIUMD_SKIP_IF_PRESENT=1 npm run fetch:veriumd
  VERICOIND_TARGET_TRIPLE="$TARGET" VERICOIND_REQUIRED=0 npm run fetch:vericoind

  log "Cargo check + test + tauri build"
  cargo check --manifest-path src-tauri/Cargo.toml --target "$TARGET"
  cargo test --manifest-path src-tauri/Cargo.toml --target "$TARGET"
  npx tauri build --target "$TARGET"

  log "Bundles"
  find src-tauri/target/"$TARGET"/release/bundle -type f \
    \( -name '*.AppImage' -o -name '*.deb' -o -name '*.dmg' -o -name '*.exe' -o -name '*.msi' \) \
    -print 2>/dev/null || true
}

[[ "$INSTALL_DEPS" == "1" ]] && install_sidecar_deps
if [[ "$INSTALL_DEPS" == "1" ]] && [[ "$KIND" == "linux" ]]; then
  install_wallet_deps_linux
  install_node_rust_wsl
fi

if [[ "${DEPS_ONLY:-0}" == "1" ]]; then
  log "Dependencies installed"
  exit 0
fi

case "$PHASE" in
  sidecar)
    build_sidecar
    ;;
  wallet)
    [[ "$SKIP_SIDECAR_BUILD" == "0" ]] && build_sidecar
    build_wallet
    ;;
  all)
    build_sidecar
    if [[ "$KIND" == "linux" && "$TARGET" == "x86_64-unknown-linux-gnu" ]]; then
      build_wallet
    else
      log "Skipping wallet (run on native Linux x64 host with --phase wallet to bundle Tauri)"
    fi
    ;;
  *)
    echo "Unknown --phase: $PHASE (use sidecar|wallet|all)" >&2
    exit 1
    ;;
esac

log "Done ($TARGET, phase=$PHASE)"
