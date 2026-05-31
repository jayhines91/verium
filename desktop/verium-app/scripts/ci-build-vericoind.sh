#!/usr/bin/env bash
# Build vericoind for CI sidecar packaging (mirrors veriumd depends workflow).
set -euo pipefail

VERICOIN_REF="${VERICOIN_GIT_REF:-master}"
VERICOIN_REPO="${VERICOIN_GIT_URL:-https://github.com/VeriConomy/vericoin.git}"
TARGET="${VERICOIND_CI_TARGET:?VERICOIND_CI_TARGET required}"
KIND="${VERICOIND_CI_KIND:?VERICOIND_CI_KIND required}"
HOST="${VERICOIND_CI_HOST:?VERICOIND_CI_HOST required}"
CONFIGURE_EXTRA="${VERICOIND_CONFIGURE_EXTRA:-}"
OUT_DIR="${VERICOIND_OUT_DIR:-out}"

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${VERICOIN_BUILD_DIR:-$APP_ROOT/../../.ci-vericoin-src}"
OUT_BASE="$APP_ROOT/${VERICOIND_OUT_DIR:-src-tauri/binaries}"

if [[ ! -d "$BUILD_DIR/.git" ]]; then
  git clone --depth 1 --branch "$VERICOIN_REF" "$VERICOIN_REPO" "$BUILD_DIR"
else
  git -C "$BUILD_DIR" fetch --depth 1 origin "$VERICOIN_REF" 2>/dev/null || true
  git -C "$BUILD_DIR" checkout -f FETCH_HEAD 2>/dev/null || git -C "$BUILD_DIR" checkout -f "$VERICOIN_REF"
fi

cd "$BUILD_DIR"
JOBS=$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)

if [[ "$KIND" == "macos" ]]; then
  brew install automake libtool pkg-config || true
  python3 -m pip install --user --break-system-packages --upgrade pip setuptools wheel 2>/dev/null || true
fi

if [[ "$KIND" == "linux" || "$KIND" == "mingw" ]]; then
  ./autogen.sh
  export CONFIG_SITE="$(pwd)/depends/$HOST/share/config.site"
  EXTRA=""
  if [[ "$KIND" == "mingw" ]]; then
    EXTRA="ac_cv_search_clock_gettime=no"
  fi
  make -C depends HOST="$HOST" NO_QT=1 -j"$JOBS"
  ./configure \
    --host="$HOST" \
    --prefix="$(pwd)/depends/$HOST" \
    --without-gui --disable-tests --disable-bench \
    --enable-reduce-exports --disable-shared --enable-static \
    $CONFIGURE_EXTRA $EXTRA
  if [[ "$KIND" == "mingw" ]]; then
    make -j"$JOBS" src/vericoind.exe
    mkdir -p "$OUT_BASE"
    cp src/vericoind.exe "$OUT_BASE/vericoind-${TARGET}.exe"
  else
    make -j"$JOBS" src/vericoind
    mkdir -p "$OUT_BASE"
    cp src/vericoind "$OUT_BASE/vericoind-${TARGET}"
    chmod +x "$OUT_BASE/vericoind-${TARGET}"
  fi
  exit 0
fi

if [[ "$KIND" == "macos" ]]; then
  ./autogen.sh
  export CONFIG_SITE="$(pwd)/depends/$HOST/share/config.site"
  case "$HOST" in
    aarch64-*) export MACOSX_DEPLOYMENT_TARGET=11.0 ;;
    *) export MACOSX_DEPLOYMENT_TARGET=10.15 ;;
  esac
  make -C depends HOST="$HOST" NO_QT=1 -j"$JOBS"
  ./configure \
    --host="$HOST" \
    --prefix="$(pwd)/depends/$HOST" \
    --without-gui --disable-tests --disable-bench \
    --enable-reduce-exports --disable-shared --enable-static \
    $CONFIGURE_EXTRA
  make -j"$JOBS" src/vericoind
  mkdir -p "$OUT_BASE"
  cp src/vericoind "$OUT_BASE/vericoind-${TARGET}"
  chmod +x "$OUT_BASE/vericoind-${TARGET}"
  exit 0
fi

echo "Unsupported VERICOIND_CI_KIND=$KIND"
exit 1
