#!/bin/bash
# Run configure + make + package (after depends are built)
# Use: ./Build-Scripts/do-configure-make.sh
set -e
cd "$(dirname "$0")/.."
HOST_TRIPLET=x86_64-pc-linux-gnu
export CC=gcc-9 CXX=g++-9

export CONFIG_SITE="$(pwd)/depends/${HOST_TRIPLET}/share/config.site"
DEP="$(pwd)/depends/${HOST_TRIPLET}"
export BOOST_CPPFLAGS="-I$DEP/include"
export BOOST_LDFLAGS="-L$DEP/lib"
export CPPFLAGS="$BOOST_CPPFLAGS ${CPPFLAGS:-}"
export LDFLAGS="$BOOST_LDFLAGS ${LDFLAGS:-}"

bs="$(ls "$DEP/lib"/libboost_system*.a 2>/dev/null | head -n1 || true)"
if [ -z "$bs" ]; then
  echo "ERROR: No libboost_system - run depends build first"
  exit 1
fi
suf="${bs##*/}"; suf="${suf#libboost_system}"; suf="${suf%.a}"
export BOOST_LIB_SUFFIX="$suf"
export BOOST_THREAD_LIB_SUFFIX="$suf"
export LIBS="${LIBS:-} -pthread -lrt"

./autogen.sh
CC=gcc-9 CXX=g++-9 ./configure \
  --host=$HOST_TRIPLET --prefix="$DEP" \
  --with-gui=qt5 \
  --with-qt-bindir="$DEP/native/bin" \
  --with-qt-incdir="$DEP/include" --with-qt-libdir="$DEP/lib" \
  --with-boost="$DEP" --with-boost-libdir="$DEP/lib" \
  --disable-bench --disable-tests \
  --enable-reduce-exports --disable-shared --enable-static

make -j$(nproc)

# Package (layout matches Windows: root, daemon/, doc/, manpages/, share/)
V=$(grep '^PACKAGE_VERSION' Makefile 2>/dev/null | sed 's/.*= *//' | tr -d ' ') || echo "1.3.5.2"
OUTDIR="out-linux"
rm -rf "$OUTDIR"
mkdir -p "$OUTDIR"/{daemon,doc,manpages,share/applications,share/pixmaps,share/icons/hicolor/128x128/apps}

cp -f src/qt/verium-qt "$OUTDIR/"
cp -f COPYING "$OUTDIR/"
cp -f doc/README_windows.txt "$OUTDIR/readme.txt"
cp -f src/veriumd src/verium-cli src/verium-tx src/verium-wallet "$OUTDIR/daemon/" 2>/dev/null || true
cp -r doc "$OUTDIR/"
rm -rf "$OUTDIR/doc/man"
find "$OUTDIR/doc" -name 'Makefile*' -delete 2>/dev/null || true
./contrib/release-tools/gather-manpages.sh "$OUTDIR/manpages"
cp -f share/applications/verium-qt.desktop "$OUTDIR/share/applications/"
cp -f share/pixmaps/verium-qt.png "$OUTDIR/share/pixmaps/"
cp -f share/pixmaps/verium-qt.png "$OUTDIR/share/icons/hicolor/128x128/apps/"
cp -f contrib/release-tools/INSTALL_LINUX.txt "$OUTDIR/"

PKG="verium-${V}-${HOST_TRIPLET}.tar.gz"
echo "=== Removing previous Linux tarballs ==="
shopt -s nullglob
for old in verium-*-"${HOST_TRIPLET}".tar.gz verium-*-"${HOST_TRIPLET}".tar.gz.SHA256SUMS; do
  echo "Deleting $old"
  rm -f "$old"
done
shopt -u nullglob
tar -C "$OUTDIR" -czf "$PKG" .
sha256sum "$PKG" > "${PKG}.SHA256SUMS"
echo "=== Built: $PKG ==="
ls -la "$PKG" "${PKG}.SHA256SUMS"
