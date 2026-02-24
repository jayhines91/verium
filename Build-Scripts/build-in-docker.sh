#!/bin/bash
# Run full Linux64 build inside ubuntu-22.04 container (matches GitHub Actions)
set -e
cd "$(dirname "$0")/.."
HOST_TRIPLET=x86_64-pc-linux-gnu

docker run --rm \
  -v "$(pwd):/build" \
  -w /build \
  ubuntu:22.04 \
  bash -c "
    set -e
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y gcc-9 g++-9 gcc-11 g++-11 build-essential automake libtool pkg-config python3 curl zip unzip ccache
    update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-9 100 \
      --slave /usr/bin/g++ g++ /usr/bin/g++-9 \
      --slave /usr/bin/gcov gcov /usr/bin/gcov-9 \
      --slave /usr/bin/gcc-ar gcc-ar /usr/bin/gcc-ar-9 \
      --slave /usr/bin/gcc-ranlib gcc-ranlib /usr/bin/gcc-ranlib-9 \
      --slave /usr/bin/gcc-nm gcc-nm /usr/bin/gcc-nm-9
    export CC=gcc-9 CXX=g++-9 HOST_TRIPLET=$HOST_TRIPLET
    gcc --version
    g++ --version

    echo '=== Priming FreeType with GCC 11 ==='
    make -C depends HOST=\$HOST_TRIPLET CC=gcc-11 CXX=g++-11 freetype -j\$(nproc)

    echo '=== Building full depends ==='
    make -C depends HOST=\$HOST_TRIPLET CC=gcc-9 CXX=g++-9 -j\$(nproc)

    echo '=== Autogen ==='
    ./autogen.sh

    echo '=== Configuring ==='
    export CONFIG_SITE=\"\$(pwd)/depends/\$HOST_TRIPLET/share/config.site\"
    DEP=\"\$(pwd)/depends/\$HOST_TRIPLET\"
    export BOOST_CPPFLAGS=\"-I\$DEP/include\"
    export BOOST_LDFLAGS=\"-L\$DEP/lib\"
    export CPPFLAGS=\"\$BOOST_CPPFLAGS\"
    export LDFLAGS=\"\$BOOST_LDFLAGS\"
    bs=\"\$(ls \"\$DEP/lib\"/libboost_system*.a 2>/dev/null | head -n1 || true)\"
    if [ -z \"\$bs\" ]; then echo 'ERROR: No libboost_system'; exit 1; fi
    suf=\"\${bs##*/}\"; suf=\"\${suf#libboost_system}\"; suf=\"\${suf%.a}\"
    export BOOST_LIB_SUFFIX=\"\$suf\"
    export BOOST_THREAD_LIB_SUFFIX=\"\$suf\"
    export LIBS=\"-pthread -lrt\"
    CC=gcc-9 CXX=g++-9 ./configure --host=\$HOST_TRIPLET --prefix=\"\$DEP\" --with-gui=qt5 \\
      --with-qt-bindir=\"\$DEP/native/bin\" --with-qt-incdir=\"\$DEP/include\" --with-qt-libdir=\"\$DEP/lib\" \\
      --with-boost=\"\$DEP\" --with-boost-libdir=\"\$DEP/lib\" \\
      --disable-bench --disable-tests --enable-reduce-exports --disable-shared --enable-static

    echo '=== Building ==='
    make clean
    make CC=\$CC CXX=\$CXX -j\$(nproc)

    echo '=== Packaging ==='
    V=\$(grep '^PACKAGE_VERSION' Makefile 2>/dev/null | sed 's/.*= *//' | tr -d ' ') || echo '1.3.5.2'
    OUTDIR=\"out-linux\"
    rm -rf \"\$OUTDIR\"
    mkdir -p \"\$OUTDIR\"/{daemon,doc,manpages,share/applications,share/pixmaps,share/icons/hicolor/128x128/apps}
    cp -f src/qt/verium-qt \"\$OUTDIR/\"
    cp -f COPYING \"\$OUTDIR/\"
    cp -f doc/README_windows.txt \"\$OUTDIR/readme.txt\"
    cp -f src/veriumd src/verium-cli src/verium-tx src/verium-wallet \"\$OUTDIR/daemon/\" 2>/dev/null || true
    cp -r doc \"\$OUTDIR/\"
    rm -rf \"\$OUTDIR/doc/man\"
    find \"\$OUTDIR/doc\" -name 'Makefile*' -delete 2>/dev/null || true
    ./contrib/release-tools/gather-manpages.sh \"\$OUTDIR/manpages\"
    cp -f share/applications/verium-qt.desktop \"\$OUTDIR/share/applications/\"
    cp -f share/pixmaps/verium-qt.png \"\$OUTDIR/share/pixmaps/\"
    cp -f share/pixmaps/verium-qt.png \"\$OUTDIR/share/icons/hicolor/128x128/apps/\"
    cp -f contrib/release-tools/INSTALL_LINUX.txt \"\$OUTDIR/\"
    PKG=\"verium-\${V}-x86_64-pc-linux-gnu.tar.gz\"
    tar -C \"\$OUTDIR\" -czf \"\$PKG\" .
    sha256sum \"\$PKG\" > \"\${PKG}.SHA256SUMS\"
    echo \"Built: \$PKG\"
    ls -la \"\$PKG\" \"\${PKG}.SHA256SUMS\"
  "
