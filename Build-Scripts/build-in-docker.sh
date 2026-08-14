#!/bin/bash
# Linux x64 native build (out-of-tree).
#   build/linux64/  +  depends/x86_64-pc-linux-gnu/  +  out-linux64/
#
# Depends always sync from CodeRepo/shared/depends-preseed (see build-common.sh).
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# shellcheck source=build-common.sh
source Build-Scripts/build-common.sh
mapfile -t PRESEED_MOUNT < <(docker_shared_preseed_mount_args "$ROOT")

PLATFORM=linux64
HOST_TRIPLET=x86_64-pc-linux-gnu
BUILD_DIR="build/${PLATFORM}"
OUT_DIR="out-${PLATFORM}"

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
      curl git bison ca-certificates gcc-9 g++-9

    update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-9 100
    update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-9 100

    clean_root_configure_artifacts /build
    ensure_depends ${HOST_TRIPLET} /build
    ensure_autogen /build
    configure_platform_build ${BUILD_DIR} ${HOST_TRIPLET} '' /build
    platform_make ${BUILD_DIR} /build 4

    cd /build
    prepare_output_dirs /build ${OUT_DIR}
    cp -f ${BUILD_DIR}/src/veriumd ${BUILD_DIR}/src/verium-cli ${BUILD_DIR}/src/verium-tx \
          ${BUILD_DIR}/src/verium-wallet ${BUILD_DIR}/src/qt/verium-qt /build/${OUT_DIR}/
    chown 1000:1000 /build/${OUT_DIR}/* 2>/dev/null || true

    echo '=== Linux x64 build complete ==='
    ls -la /build/${OUT_DIR}/
  "
