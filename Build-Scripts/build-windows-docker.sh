#!/bin/bash
# Run Windows x64 cross-compile build inside ubuntu-22.04 (matches Windows64Build workflow)
set -e
cd "$(dirname "$0")/.."
HOST_TRIPLET=x86_64-w64-mingw32

docker run --rm \
  -v "$(pwd):/build" \
  -w /build \
  ubuntu:22.04 \
  bash -c "
    set -e
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y build-essential automake libtool pkg-config python3 \
      g++-mingw-w64-x86-64 binutils-mingw-w64-x86-64 \
      curl zip unzip ccache gcc-9 g++-9 nsis
    update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-9 100
    update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-9 100
    update-alternatives --set x86_64-w64-mingw32-gcc /usr/bin/x86_64-w64-mingw32-gcc-posix
    update-alternatives --set x86_64-w64-mingw32-g++ /usr/bin/x86_64-w64-mingw32-g++-posix

    export RC=\${HOST_TRIPLET}-windres WINDRES=\${HOST_TRIPLET}-windres
    export HOST_TRIPLET=$HOST_TRIPLET

    echo '=== Hotfix sync.h / logging.h ==='
    [ -f src/sync.h ] && ! grep -q '<mutex>' src/sync.h && awk '{print; if (\$0~/#include[[:space:]]*<thread>/) {print \"#include <mutex>\"; print \"#include <condition_variable>\"}}' src/sync.h > src/sync.h.new && mv src/sync.h.new src/sync.h || true
    [ -f src/logging.h ] && ! grep -q '<mutex>' src/logging.h && awk '{print; if (\$0~/#include[[:space:]]*<tinyformat\\.h>/) {print \"#include <mutex>\"}}' src/logging.h > src/logging.h.new && mv src/logging.h.new src/logging.h || true

    echo '=== Patch curl.mk for Win64 ==='
    f=depends/packages/curl.mk
    [ -f \"\$f\" ] && {
      echo '' >> \"\$f\"
      echo '# CI: cross-compile opts for Windows' >> \"\$f\"
      echo '\$(package)_config_opts += --disable-debug --disable-curldebug --disable-ldap --disable-ldaps --without-libidn2 --without-libpsl --without-brotli --without-zstd --without-nghttp2 --without-ssh --without-libssh2 --without-rtmp' >> \"\$f\"
      echo '\$(package)_config_opts_mingw32 += --with-winssl' >> \"\$f\"
      echo '\$(package)_config_opts_mingw64 += --with-winssl' >> \"\$f\"
      echo '\$(package)_conf_env += ac_cv_func_strerror_r=no ac_cv_strerror_r_char_p=no ac_cv_func_clock_gettime=no ac_cv_header_dlfcn_h=no ac_cv_have_decl_strerror_r=yes' >> \"\$f\"
      rm -rf depends/work/build/*/curl/
    }

    echo '=== Build depends (cap -j4 for OOM) ==='
    make -C depends HOST=\$HOST_TRIPLET CC_FOR_BUILD=gcc-9 CXX_FOR_BUILD=g++-9 -j4 RC=\"\$RC\" WINDRES=\"\$WINDRES\" || {
      find depends/work/build -name config.log -exec sh -c 'echo \"==> {}\"; tail -n 80 \"{}\"' \\;
      exit 1
    }

    echo '=== Patch chainparams seeds ==='
    [ -f src/chainparams.cpp ] && perl -0777 -pe 's/vSeeds\\.emplace_back\\(\\s*\"[^\"]+\"\\s*,\\s*\"([^\"]+)\"\\s*(?:,\\s*(?:true|false))?\\s*\\)/vSeeds.push_back(\"\$1\")/g' -i src/chainparams.cpp || true
    [ -f src/chainparams.cpp ] && perl -0777 -pe 's/vSeeds\\.push_back\\(\\s*CDNSSeedData\\(\\s*\"[^\"]+\"\\s*,\\s*\"([^\"]+)\"\\s*(?:,\\s*(?:true|false))?\\s*\\)\\s*\\)/vSeeds.push_back(\"\$1\")/g' -i src/chainparams.cpp || true

    echo '=== gmtime_r shim for Windows ==='
    if [ -f src/util/time.cpp ] && ! grep -q 'gmtime_r_compat' src/util/time.cpp; then
      { echo '#ifdef _WIN32'; echo '#include <time.h>'; echo 'static inline struct tm* gmtime_r_compat(const time_t* t, struct tm* res){ return gmtime_s(res,t)==0 ? res : NULL; }'; echo '#define gmtime_r(t,r) gmtime_r_compat((t),(r))'; echo '#endif'; cat src/util/time.cpp; } > src/util/time.cpp.tmp && mv src/util/time.cpp.tmp src/util/time.cpp
    fi

    echo '=== Init Qt automake vars ==='
    [ -f src/Makefile.qt.include ] && ! grep -q '^[[:space:]]*LIBBITCOINQT_LIBS[[:space:]]*=' src/Makefile.qt.include && sed -i '1i LIBBITCOINQT_LIBS =\nLIBBITCOINQT_INCLUDES =' src/Makefile.qt.include || true

    echo '=== Autogen + Configure ==='
    ./autogen.sh
    export CONFIG_SITE=\"\$(pwd)/depends/\$HOST_TRIPLET/share/config.site\"
    rm -f config.cache
    DEP=\"\$(pwd)/depends/\$HOST_TRIPLET\"
    ./configure --host=\$HOST_TRIPLET --prefix=\"\$DEP\" --with-gui=qt5 \\
      --with-qt-bindir=\"\$DEP/native/bin\" --with-qt-incdir=\"\$DEP/include\" --with-qt-libdir=\"\$DEP/lib\" \\
      --disable-bench --disable-tests --enable-reduce-exports --disable-shared --enable-static \\
      ac_cv_search_clock_gettime=no

    echo '=== Build (cap -j4 to reduce OOM risk) ==='
    make clean
    make -j4

    echo '=== Package ==='
    V=\$(git describe --tags --dirty --always 2>/dev/null || echo untagged)
    PKG=\"verium-\${V}-\${HOST_TRIPLET}.zip\"
    mkdir -p out
    cp -f src/*.exe out/ 2>/dev/null || true
    cp -f src/qt/*.exe out/ 2>/dev/null || true
    [ -n \"\$(ls -A out)\" ] || { echo 'No Windows EXEs'; exit 2; }
    ./contrib/release-tools/gather-manpages.sh out/share/man/man1
    (cd out && zip -r \"../\$PKG\" .)
    sha256sum \"\$PKG\" > \"\${PKG}.SHA256SUMS\"

    echo '=== NSIS Installer ==='
    make deploy
    SETUP=\$(ls verium-*-win64-setup.exe 2>/dev/null | head -1)
    [ -n \"\$SETUP\" ] || { echo 'NSIS installer not built'; exit 3; }
    sha256sum \"\$SETUP\" >> \"\${PKG}.SHA256SUMS\"
    echo \"Built: \$PKG, \$SETUP\"
    ls -la \"\$PKG\" \"\$SETUP\" \"\${PKG}.SHA256SUMS\"
  "
