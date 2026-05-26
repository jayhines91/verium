# Shared helpers for out-of-tree, per-platform Verium builds.
# Each platform uses its own:
#   build/<platform>/          configure + object files
#   depends/<host-triplet>/    cached dependency toolchain
#   out-<platform>/            binaries
#   release-<platform>/        stripped binaries (where applicable)
#
# Never configure at the repo root — that pollutes src/ and breaks cross-compiles.

build_common_root() {
    cd "$(dirname "${BASH_SOURCE[0]}")/.."
    BUILD_COMMON_ROOT="$(pwd)"
}

# Remove accidental in-tree configure/build artifacts (not platform build dirs).
clean_root_configure_artifacts() {
    local root="${1:-$BUILD_COMMON_ROOT}"
    cd "$root"

    if [ -f config.status ] || [ -f Makefile ]; then
        echo "=== Cleaning stale in-tree configure at repo root ==="
        rm -f config.status config.log Makefile libtool
        rm -rf src/config/bitcoin-config.h src/config/stamp-h1
        find src -name '*.o' -delete
        find src -name '*.a' -delete
        find src -name '*.lo' -delete
        find src -name '.deps' -type d -prune -exec rm -rf {} + 2>/dev/null || true
    fi

    # Subproject configure leakage from old in-tree builds
    rm -rf src/univalue/config.* src/univalue/Makefile src/univalue/libtool src/univalue/.libs
    rm -rf src/secp256k1/config.* src/secp256k1/Makefile src/secp256k1/libtool src/secp256k1/.libs
}

ensure_autogen() {
    local root="${1:-$BUILD_COMMON_ROOT}"
    cd "$root"
    if [ ! -x configure ]; then
        ./autogen.sh
    fi
}

ensure_depends() {
    local host_triplet="$1"
    local root="${2:-$BUILD_COMMON_ROOT}"
    local extra_make_args="${3:-}"
    cd "$root"

    # Use monorepo shared macOS SDKs when available (see shared/depends-preseed/).
    local shared_preseed="${SHARED_DEPENDS_PRESEED:-$(cd "${root}/../shared/depends-preseed" 2>/dev/null && pwd || true)}"
    if [ -n "$shared_preseed" ] && [ -d "${shared_preseed}/SDKs" ] && [[ "$extra_make_args" != *SDK_PATH=* ]]; then
        extra_make_args="SDK_PATH=${shared_preseed}/SDKs ${extra_make_args}"
    fi

    if [ ! -f "depends/${host_triplet}/lib/libcurl.a" ]; then
        echo "=== Building depends/${host_triplet} (first run only) ==="
        # shellcheck disable=SC2086
        make -C depends HOST="$host_triplet" CC_FOR_BUILD=gcc-9 CXX_FOR_BUILD=g++-9 -j4 $extra_make_args
    else
        echo "=== Reusing depends/${host_triplet} ==="
    fi
}

configure_platform_build() {
    local build_dir="$1"
    local host_triplet="$2"
    local configure_extra="${3:-}"
    local root="${4:-$BUILD_COMMON_ROOT}"
    cd "$root"
    mkdir -p "$build_dir"
    cd "$build_dir"

    export CONFIG_SITE="${root}/depends/${host_triplet}/share/config.site"
    local dep="${root}/depends/${host_triplet}"

    if [ -f config.status ]; then
        echo "=== Reusing existing ${build_dir} (incremental) ==="
        return 0
    fi

    echo "=== Configuring ${build_dir} for ${host_triplet} ==="
    rm -f config.cache
    # shellcheck disable=SC2086
    ../../configure --host="$host_triplet" --prefix="$dep" --with-gui=qt5 \
        --with-qt-bindir="$dep/native/bin" --with-qt-incdir="$dep/include" --with-qt-libdir="$dep/lib" \
        --disable-bench --disable-tests --enable-reduce-exports \
        $configure_extra
}

ensure_secp256k1_gen_context() {
    local build_dir="$1"
    local root="${2:-$BUILD_COMMON_ROOT}"
    cd "${root}/${build_dir}/src/secp256k1"
    if [ -x gen_context ]; then
        return 0
    fi
    echo "=== Building native gen_context for ${build_dir} ==="
    gcc-9 -I../../../../src/secp256k1/src -I../../../../src/secp256k1 \
        -c ../../../../src/secp256k1/src/gen_context.c -o gen_context.o
    gcc-9 gen_context.o -o gen_context
}

platform_make() {
    local build_dir="$1"
    local root="${2:-$BUILD_COMMON_ROOT}"
    local jobs="${3:-4}"
    cd "${root}/${build_dir}"
    make -j"$jobs" -C src/univalue
    make -j"$jobs"
}

prepare_output_dirs() {
    local root="${1:-$BUILD_COMMON_ROOT}"
    local out_dir="$2"
    local release_dir="${3:-}"
    mkdir -p "${root}/${out_dir}"
    if [ -n "$release_dir" ]; then
        mkdir -p "${root}/${release_dir}"
    fi
}

# --- Windows Developer Edition (debug machine) --------------------------------

WINDOWS_DEV_HOST_TRIPLET="${WINDOWS_DEV_HOST_TRIPLET:-x86_64-w64-mingw32}"
WINDOWS_DEV_BUILD_DIR="${WINDOWS_DEV_BUILD_DIR:-build/windows-dev}"
WINDOWS_DEV_OUT_DIR="${WINDOWS_DEV_OUT_DIR:-out-windows-dev}"
WINDOWS_DEV_RELEASE_DIR="${WINDOWS_DEV_RELEASE_DIR:-release-windows-dev}"

require_dev_helper_enabled() {
    local root="${1:-$BUILD_COMMON_ROOT}"
    if ! grep -q '^#define ENABLE_DEV_HELPER_WINDOW 1' "${root}/src/util/devhelperconfig.h" 2>/dev/null; then
        echo "ERROR: Developer Edition requires ENABLE_DEV_HELPER_WINDOW 1 in src/util/devhelperconfig.h" >&2
        echo "       Set it to 1 on this debug machine, then re-run." >&2
        echo "       For holder/release builds use Build-Scripts/build-windows-docker.sh with the flag at 0." >&2
        exit 1
    fi
}

ensure_windows_cross_toolchain() {
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y build-essential automake libtool pkg-config python3 \
        g++-mingw-w64-x86-64 binutils-mingw-w64-x86-64 \
        curl zip unzip gcc-9 g++-9 nsis git

    update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-9 100
    update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-9 100
    update-alternatives --set x86_64-w64-mingw32-gcc /usr/bin/x86_64-w64-mingw32-gcc-posix
    update-alternatives --set x86_64-w64-mingw32-g++ /usr/bin/x86_64-w64-mingw32-g++-posix

    export RC="${WINDOWS_DEV_HOST_TRIPLET}-windres"
    export WINDRES="${WINDOWS_DEV_HOST_TRIPLET}-windres"
}

patch_curl_mk_for_windows_cross() {
    local root="${1:-$BUILD_COMMON_ROOT}"
    local f="${root}/depends/packages/curl.mk"
    if [ -f "$f" ] && ! grep -q 'CI: cross-compile opts' "$f"; then
        cat >> "$f" <<'EOF'

# CI: cross-compile opts for Windows
$(package)_config_opts += --disable-debug --disable-curldebug --disable-ldap --disable-ldaps --without-libidn2 --without-libpsl --without-brotli --without-zstd --without-nghttp2 --without-ssh --without-libssh2 --without-rtmp
$(package)_config_opts_mingw32 += --with-winssl
$(package)_config_opts_mingw64 += --with-winssl
$(package)_conf_env += ac_cv_func_strerror_r=no ac_cv_strerror_r_char_p=no ac_cv_func_clock_gettime=no ac_cv_header_dlfcn_h=no ac_cv_have_decl_strerror_r=yes
EOF
    fi
}

patch_time_cpp_for_windows_cross() {
    local root="${1:-$BUILD_COMMON_ROOT}"
    if [ -f "${root}/src/util/time.cpp" ] && ! grep -q gmtime_r_compat "${root}/src/util/time.cpp"; then
        {
            echo '#ifdef _WIN32'
            echo '#include <time.h>'
            echo 'static inline struct tm* gmtime_r_compat(const time_t* t, struct tm* res){ return gmtime_s(res,t)==0 ? res : NULL; }'
            echo '#define gmtime_r(t,r) gmtime_r_compat((t),(r))'
            echo '#endif'
            cat "${root}/src/util/time.cpp"
        } > "${root}/src/util/time.cpp.tmp" && mv "${root}/src/util/time.cpp.tmp" "${root}/src/util/time.cpp"
    fi
}

copy_windows_dev_binaries() {
    local root="${1:-$BUILD_COMMON_ROOT}"
    local build_dir="${2:-$WINDOWS_DEV_BUILD_DIR}"
    local out_dir="${3:-$WINDOWS_DEV_OUT_DIR}"
    local release_dir="${4:-$WINDOWS_DEV_RELEASE_DIR}"

    prepare_output_dirs "$root" "$out_dir" "$release_dir"
    cp -f "${root}/${build_dir}/src/"*.exe "${root}/${out_dir}/" 2>/dev/null || true
    cp -f "${root}/${build_dir}/src/qt/"*.exe "${root}/${out_dir}/" 2>/dev/null || true
    cp -f "${root}/${build_dir}/release/"*.exe "${root}/${release_dir}/" 2>/dev/null || true
}

clean_windows_dev_output_dir() {
    local root="${1:-$BUILD_COMMON_ROOT}"
    local out_dir="${2:-$WINDOWS_DEV_OUT_DIR}"
    if [ -d "${root}/${out_dir}" ]; then
        echo "=== Cleaning ${out_dir}/ before dev build ==="
        rm -rf "${root}/${out_dir}"
    fi
}

# Compile all Windows dev binaries and build the Developer Edition NSIS installer.
run_windows_dev_compile_and_package() {
    local root="${1:-$BUILD_COMMON_ROOT}"
    local host_triplet="${WINDOWS_DEV_HOST_TRIPLET}"
    local build_dir="${WINDOWS_DEV_BUILD_DIR}"
    local out_dir="${WINDOWS_DEV_OUT_DIR}"

    require_dev_helper_enabled "$root"
    clean_windows_dev_output_dir "$root" "$out_dir"
    ensure_windows_cross_toolchain
    patch_curl_mk_for_windows_cross "$root"
    patch_time_cpp_for_windows_cross "$root"

    clean_root_configure_artifacts "$root"
    ensure_depends "$host_triplet" "$root" "RC=\$RC WINDRES=\$WINDRES"
    ensure_autogen "$root"
    configure_platform_build "$build_dir" "$host_triplet" \
        '--disable-shared --enable-static ac_cv_search_clock_gettime=no' "$root"
    ensure_secp256k1_gen_context "$build_dir" "$root"
    platform_make "$build_dir" "$root" 4

    copy_windows_dev_binaries "$root" "$build_dir" "$out_dir" "$WINDOWS_DEV_RELEASE_DIR"

    chmod +x "${root}/Build-Scripts/package-windows-dev-installer.sh"
    "${root}/Build-Scripts/package-windows-dev-installer.sh" "$root"

    echo "=== Windows Developer Edition recompile complete ==="
    echo "Binaries + installer: ${root}/${out_dir}/"
    ls -la "${root}/${out_dir}/"
}
