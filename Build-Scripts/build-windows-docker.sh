#!/bin/bash
# Windows x64 cross-compile (out-of-tree) — holder / release builds.
#   build/windows/  +  depends/x86_64-w64-mingw32/  +  out-windows/
#
# Depends always sync from CodeRepo/shared/depends-preseed (see build-common.sh).
# For Developer Edition use Build-Scripts/build-windows-dev-docker.sh → out-windows-dev/
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# shellcheck source=build-common.sh
source Build-Scripts/build-common.sh
mapfile -t PRESEED_MOUNT < <(docker_shared_preseed_mount_args "$ROOT")

PLATFORM=windows
HOST_TRIPLET=x86_64-w64-mingw32
BUILD_DIR="build/${PLATFORM}"
OUT_DIR="out-${PLATFORM}"
RELEASE_DIR="release-${PLATFORM}"

docker run --rm \
  -v "$ROOT:/build" \
  "${PRESEED_MOUNT[@]}" \
  -w /build \
  ubuntu:22.04 \
  bash -c "
    set -e
    source Build-Scripts/build-common.sh
    build_common_root

    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y build-essential automake libtool pkg-config python3 \
      g++-mingw-w64-x86-64 binutils-mingw-w64-x86-64 \
      curl zip unzip gcc-9 g++-9 nsis git

    update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-9 100
    update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-9 100
    update-alternatives --set x86_64-w64-mingw32-gcc /usr/bin/x86_64-w64-mingw32-gcc-posix
    update-alternatives --set x86_64-w64-mingw32-g++ /usr/bin/x86_64-w64-mingw32-g++-posix

    export RC=\${HOST_TRIPLET}-windres WINDRES=\${HOST_TRIPLET}-windres

    patch_curl_mk_for_windows_cross /build
    patch_time_cpp_for_windows_cross /build
    clean_root_configure_artifacts /build
    ensure_depends ${HOST_TRIPLET} /build \"RC=\\\$RC WINDRES=\\\$WINDRES\"
    ensure_autogen /build
    configure_platform_build ${BUILD_DIR} ${HOST_TRIPLET} '--disable-shared --enable-static ac_cv_search_clock_gettime=no' /build
    ensure_secp256k1_gen_context ${BUILD_DIR} /build
    platform_make ${BUILD_DIR} /build 4

    cd /build/${BUILD_DIR}
    make deploy || true

    prepare_output_dirs /build ${OUT_DIR} ${RELEASE_DIR}
    cp -f src/*.exe /build/${OUT_DIR}/ 2>/dev/null || true
    cp -f src/qt/*.exe /build/${OUT_DIR}/ 2>/dev/null || true
    cp -f release/*.exe /build/${RELEASE_DIR}/ 2>/dev/null || true
    cp -f *win64-setup*.exe /build/${OUT_DIR}/ 2>/dev/null || true

    echo '=== Windows build complete ==='
    ls -la /build/${OUT_DIR}/ /build/${RELEASE_DIR}/ 2>/dev/null || true
  "
