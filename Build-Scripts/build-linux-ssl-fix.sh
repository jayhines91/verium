#!/bin/bash
# Linux-only rebuild: SSL fix tarball with verbose logging and incremental retries.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST_TRIPLET=x86_64-pc-linux-gnu
LOG="/tmp/verium-testnet-linux-ssl-fix.log"
INCREMENTAL="${INCREMENTAL:-0}"
VERBOSE="${VERBOSE:-1}"

exec > >(tee "$LOG") 2>&1

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

log "=== Verium 1.3.5.2 Linux SSL-fix build (INCREMENTAL=${INCREMENTAL} VERBOSE=${VERBOSE}) ==="
log "Log: $LOG"

MAKE_FLAGS="-j$(nproc)"
if [ "$VERBOSE" = "1" ]; then
  MAKE_FLAGS="$MAKE_FLAGS V=1"
fi

docker run --rm \
  -v "$(pwd):/build" \
  -w /build \
  -e INCREMENTAL="$INCREMENTAL" \
  -e VERBOSE="$VERBOSE" \
  -e HOST_TRIPLET="$HOST_TRIPLET" \
  ubuntu:22.04 \
  bash -c '
    set -euo pipefail
    log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

    export DEBIAN_FRONTEND=noninteractive
    log "=== Installing build packages ==="
    apt-get update -qq
    apt-get install -y gcc-9 g++-9 gcc-11 g++-11 build-essential automake libtool pkg-config python3 curl zip unzip
    update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-9 100 \
      --slave /usr/bin/g++ g++ /usr/bin/g++-9 \
      --slave /usr/bin/gcov gcov /usr/bin/gcov-9 \
      --slave /usr/bin/gcc-ar gcc-ar /usr/bin/gcc-ar-9 \
      --slave /usr/bin/gcc-ranlib gcc-ranlib /usr/bin/gcc-ranlib-9 \
      --slave /usr/bin/gcc-nm gcc-nm /usr/bin/gcc-nm-9
    export CC=gcc-9 CXX=g++-9

    DEP="/build/depends/${HOST_TRIPLET}"
    bs="$(ls "$DEP/lib"/libboost_system*.a 2>/dev/null | head -n1 || true)"

    if [ "$INCREMENTAL" != "1" ] || [ -z "$bs" ]; then
      log "=== Sync depends ==="
      rm -rf "depends/work/build/${HOST_TRIPLET}/curl"
      make -C depends HOST="$HOST_TRIPLET" CC=gcc-9 CXX=g++-9 -j"$(nproc)" V=1
    else
      log "=== Skipping depends (incremental, cache present) ==="
    fi

    bs="$(ls "$DEP/lib"/libboost_system*.a 2>/dev/null | head -n1 || true)"
    [ -n "$bs" ] || { log "ERROR: depends incomplete — no libboost_system"; exit 1; }

    export CONFIG_SITE="/build/depends/${HOST_TRIPLET}/share/config.site"
    export BOOST_CPPFLAGS="-I$DEP/include"
    export BOOST_LDFLAGS="-L$DEP/lib"
    export CPPFLAGS="$BOOST_CPPFLAGS"
    export LDFLAGS="$BOOST_LDFLAGS"
    suf="${bs##*/}"; suf="${suf#libboost_system}"; suf="${suf%.a}"
    export BOOST_LIB_SUFFIX="$suf"
    export BOOST_THREAD_LIB_SUFFIX="$suf"
    export LIBS="-pthread -lrt"

    if [ "$INCREMENTAL" != "1" ] || [ ! -f config.status ]; then
      log "=== Autogen + configure ==="
      ./autogen.sh
      CC=gcc-9 CXX=g++-9 ./configure --host="$HOST_TRIPLET" --prefix="$DEP" --with-gui=qt5 \
        --with-qt-bindir="$DEP/native/bin" --with-qt-incdir="$DEP/include" --with-qt-libdir="$DEP/lib" \
        --with-boost="$DEP" --with-boost-libdir="$DEP/lib" \
        --disable-bench --disable-tests --enable-reduce-exports --disable-shared --enable-static
    else
      log "=== Skipping configure (incremental) ==="
    fi

    log "=== Patching endian HAVE_DECL for glibc 2.35 ==="
    for sym in BE16TOH BE32TOH BE64TOH HTOBE16 HTOBE32 HTOBE64 HTOLE16 HTOLE32 HTOLE64 LE16TOH LE32TOH LE64TOH BSWAP_16 BSWAP_32 BSWAP_64; do
      sed -i "s/#define HAVE_DECL_${sym} 0/#define HAVE_DECL_${sym} 1/" src/config/bitcoin-config.h
    done

    MAKE_FLAGS="-j$(nproc)"
    if [ "$VERBOSE" = "1" ]; then
      MAKE_FLAGS="$MAKE_FLAGS V=1"
    fi

    if [ "$INCREMENTAL" = "1" ]; then
      log "=== Incremental make (no clean) ==="
    else
      log "=== make clean + build ==="
      make clean
    fi
    make CC="$CC" CXX="$CXX" $MAKE_FLAGS

    log "=== Package ==="
    V=$(grep "^PACKAGE_VERSION" Makefile 2>/dev/null | sed "s/.*= *//" | tr -d " ") || echo "1.3.5.2"
    OUTDIR="out-linux"
    rm -rf "$OUTDIR"
    mkdir -p "$OUTDIR"/{daemon,doc,manpages,share/applications,share/pixmaps,share/icons/hicolor/128x128/apps}
    cp -f src/qt/verium-qt "$OUTDIR/"
    cp -f COPYING "$OUTDIR/"
    cp -f doc/README_windows.txt "$OUTDIR/readme.txt"
    cp -f src/veriumd src/verium-cli src/verium-tx src/verium-wallet "$OUTDIR/daemon/" 2>/dev/null || true
    cp -r doc "$OUTDIR/"
    rm -rf "$OUTDIR/doc/man"
    find "$OUTDIR/doc" -name "Makefile*" -delete 2>/dev/null || true
    ./contrib/release-tools/gather-manpages.sh "$OUTDIR/manpages"
    cp -f share/applications/verium-qt.desktop "$OUTDIR/share/applications/"
    cp -f share/pixmaps/verium-qt.png "$OUTDIR/share/pixmaps/"
    cp -f share/pixmaps/verium-qt.png "$OUTDIR/share/icons/hicolor/128x128/apps/"
    cp -f contrib/release-tools/INSTALL_LINUX.txt "$OUTDIR/"
    PKG="verium-${V}-${HOST_TRIPLET}.tar.gz"
    log "=== Removing previous Linux tarballs ==="
    shopt -s nullglob
    for old in verium-*-"${HOST_TRIPLET}".tar.gz verium-*-"${HOST_TRIPLET}".tar.gz.SHA256SUMS; do
      log "Deleting $old"
      rm -f "$old"
    done
    shopt -u nullglob
    tar -C "$OUTDIR" -czf "$PKG" .
    sha256sum "$PKG" > "${PKG}.SHA256SUMS"
    log "Built: $PKG"
    ls -la "$PKG" "${PKG}.SHA256SUMS" "$OUTDIR/verium-qt"
    strings "$OUTDIR/verium-qt" | grep -m1 "curlssl" || strings "$OUTDIR/verium-qt" | grep -m1 "Embedded CA" || log "WARN: could not confirm SSL strings in binary"
  '

log "=== Done ==="
