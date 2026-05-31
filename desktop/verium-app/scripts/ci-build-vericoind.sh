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

patch_file() {
  local file="$1" from="$2" to="$3"
  [[ -f "$file" ]] || return 0
  grep -q "$from" "$file" || return 0
  if [[ "$(uname -s)" == "Darwin" ]]; then
    sed -i '' "s/${from}/${to}/g" "$file"
  else
    sed -i "s/${from}/${to}/g" "$file"
  fi
  echo "==> Patched $file (Boost.Filesystem compatibility)"
}
# fs is boost::filesystem (see src/fs.h); std::filesystem copy_options is invalid here.
patch_file "src/wallet/db.cpp" 'fs::copy_options::overwrite_existing' 'fs::copy_option::overwrite_if_exists'
patch_file "src/wallet/walletutil.cpp" 'it.level()' 'it.depth()'

# util/bip32.h uses uint32_t but may omit <cstdint> on some GCC/libstdc++ builds.
python3 - <<'PY'
from pathlib import Path
p = Path("src/util/bip32.h")
if p.is_file():
    text = p.read_text(encoding="utf-8")
    if "#include <cstdint>" not in text:
        text = text.replace("#include <vector>", "#include <vector>\n#include <cstdint>", 1)
        p.write_text(text, encoding="utf-8")
        print("==> Patched src/util/bip32.h (#include <cstdint>)")
PY

patch_depends_recipes_for_modern_toolchains() {
  export VERIUM_ROOT="$(cd "$APP_ROOT/../.." && pwd)"
  python3 - <<'PY'
from pathlib import Path
import os
import re
import shutil

root = Path(".")
verium_root = Path(os.environ.get("VERIUM_ROOT", ""))

def patch_bdb() -> bool:
    path = root / "depends/packages/bdb.mk"
    if not path.exists():
        return False
    text = path.read_text(encoding="utf-8")
    original = text

    flags = "-Wno-error=implicit-function-declaration -Wno-error=implicit-int -Wno-error=format-security"
    if "$(package)_cflags+=" not in text:
        text = text.replace(
            "$(package)_cxxflags=-std=c++11",
            "$(package)_cxxflags=-std=c++11\n$(package)_cflags+=" + flags,
            1,
        )
    elif "-Wno-error=implicit-function-declaration" not in text:
        text = re.sub(r"^(\$\(package\)_cflags\+=.*)$", r"\1 " + flags, text, count=1, flags=re.M)

    if text != original:
        path.write_text(text, encoding="utf-8")
        return True
    return False

def patch_boost() -> bool:
    path = root / "depends/packages/boost.mk"
    if not path.exists():
        return False
    text = path.read_text(encoding="utf-8")
    original = text

    # GCC 13+ can surface Boost concept-check warnings as errors in some CI envs.
    if "-Wno-error=nonnull" not in text:
        text = re.sub(r"^(\$\(package\)_cxxflags=.*)$", r"\1 -Wno-error=nonnull", text, count=1, flags=re.M)

    darwin_flags = (
        "-Wno-enum-constexpr-conversion -Wno-deprecated-builtins "
        "-D_LIBCPP_ENABLE_CXX17_REMOVED_UNARY_BINARY_FUNCTION"
    )
    if "$(package)_cxxflags_darwin=" not in text and "$(package)_cxxflags_android=-fPIC" in text:
        text = text.replace(
            "$(package)_cxxflags_android=-fPIC",
            "$(package)_cxxflags_android=-fPIC\n$(package)_cxxflags_darwin=" + darwin_flags,
            1,
        )

    # Patch legacy Boost pthread stack checks (function-like PTHREAD_STACK_MIN on modern libc).
    if "PTHREAD_STACK_MIN" not in text and "define $(package)_preprocess_cmds" in text:
        lines = text.splitlines()
        start = next((i for i, line in enumerate(lines) if line.strip() == "define $(package)_preprocess_cmds"), None)
        end = None
        if start is not None:
            for i in range(start + 1, len(lines)):
                if lines[i].strip() == "endef":
                    end = i
                    break
        if start is not None and end is not None:
            last_cmd = None
            for i in range(end - 1, start, -1):
                if lines[i].strip():
                    last_cmd = i
                    break
            if last_cmd is not None and not lines[last_cmd].rstrip().endswith("\\"):
                lines[last_cmd] = lines[last_cmd].rstrip() + " && \\"
            patch_lines = [
                "  [ -f boost/thread/pthread/thread_data.hpp ] && \\",
                "    sed -i -E 's/#if[[:space:]]+PTHREAD_STACK_MIN[[:space:]]*>[[:space:]]*0/#ifdef PTHREAD_STACK_MIN/' boost/thread/pthread/thread_data.hpp || true && \\",
                "  [ -f libs/thread/src/pthread/thread.cpp ] && \\",
                "    sed -i -E 's/#if[[:space:]]+PTHREAD_STACK_MIN[[:space:]]*>[[:space:]]*0/#ifdef PTHREAD_STACK_MIN/' libs/thread/src/pthread/thread.cpp || true",
            ]
            lines[end:end] = patch_lines
            text = "\n".join(lines) + "\n"

    if text != original:
        path.write_text(text, encoding="utf-8")
        return True
    return False

def patch_openssl() -> bool:
    path = root / "depends/packages/openssl.mk"
    if not path.exists():
        return False
    text = path.read_text(encoding="utf-8")
    original = text

    # Some trees define darwin arm64 as "arm64", while depends host_arch resolves to "aarch64".
    # Ensure aarch64-darwin always resolves to a valid OpenSSL Configure target.
    if "$(package)_config_opts_aarch64_darwin=" not in text:
        if "$(package)_config_opts_arm64_darwin=" in text:
            text = text.replace(
                "$(package)_config_opts_arm64_darwin=",
                "$(package)_config_opts_aarch64_darwin=darwin64-arm64-cc\n$(package)_config_opts_arm64_darwin=",
                1,
            )
        elif "$(package)_config_opts_x86_64_darwin=" in text:
            text = text.replace(
                "$(package)_config_opts_x86_64_darwin=",
                "$(package)_config_opts_aarch64_darwin=darwin64-arm64-cc\n$(package)_config_opts_x86_64_darwin=",
                1,
            )
        else:
            # Fallback append if layout is unexpected.
            text = text.rstrip() + "\n$(package)_config_opts_aarch64_darwin=darwin64-arm64-cc\n"

    if text != original:
        path.write_text(text, encoding="utf-8")
        return True
    return False

def patch_package_registry() -> bool:
    path = root / "depends/packages/packages.mk"
    if not path.exists():
        return False
    text = path.read_text(encoding="utf-8")
    original = text

    # Some upstream snapshots accidentally omit zlib from the base package graph while
    # still building curl, which leaves make without a "zlib" target.
    m = re.search(r"^packages:=([^\n]*)$", text, flags=re.M)
    if m:
        rhs = m.group(1).strip()
        tokens = rhs.split()
        if "zlib" not in tokens:
            tokens.append("zlib")
            text = text[:m.start(1)] + " " + " ".join(tokens) + text[m.end(1):]
    if text != original:
        path.write_text(text, encoding="utf-8")
        return True
    return False

def patch_zeromq() -> bool:
    path = root / "depends/packages/zeromq.mk"
    if not path.exists():
        return False
    text = path.read_text(encoding="utf-8")
    original = text

    if "remove_libstd_link.patch" in text:
        text = """package=zeromq
$(package)_version=4.3.1
$(package)_download_path=https://github.com/zeromq/libzmq/releases/download/v$($(package)_version)/
$(package)_file_name=$(package)-$($(package)_version).tar.gz
$(package)_sha256_hash=bcbabe1e2c7d0eec4ed612e10b94b112dd5f06fcefa994a0c79a45d835cd21eb
$(package)_patches=0001-fix-build-with-older-mingw64.patch 0002-disable-pthread_set_name_np.patch

define $(package)_set_vars
  $(package)_config_opts=--without-docs --disable-shared --disable-curve --disable-curve-keygen --disable-perf --disable-Werror --disable-drafts
  $(package)_config_opts += --without-libsodium --without-libgssapi_krb5 --without-pgm --without-norm --without-vmci
  $(package)_config_opts += --disable-libunwind --disable-radix-tree --without-gcov
  $(package)_config_opts_linux=--with-pic
  $(package)_cxxflags=-std=c++11
endef

define $(package)_preprocess_cmds
   patch -p1 < $($(package)_patch_dir)/0001-fix-build-with-older-mingw64.patch && \\
   patch -p1 < $($(package)_patch_dir)/0002-disable-pthread_set_name_np.patch && \\
   cp -f $(BASEDIR)/config.guess $(BASEDIR)/config.sub config
endef

define $(package)_config_cmds
  $($(package)_autoconf)
endef

define $(package)_build_cmds
  $(MAKE) src/libzmq.la
endef

define $(package)_stage_cmds
  $(MAKE) DESTDIR=$($(package)_staging_dir) install-libLTLIBRARIES install-includeHEADERS install-pkgconfigDATA
endef

define $(package)_postprocess_cmds
  sed -i.old "s/ -lstdc++//" lib/pkgconfig/libzmq.pc && \\
  rm -rf bin share lib/*.la
endef
"""

    if text != original:
        path.write_text(text, encoding="utf-8")
        return True
    return False

def sync_depends_patches() -> bool:
    """Copied package recipes reference verium patch files (e.g. zlib darwin_fdopen)."""
    src = verium_root / "depends/patches"
    dst = root / "depends/patches"
    if not src.is_dir():
        print("==> WARN: verium depends/patches not found (sparse checkout?)")
        return False
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        target = dst / item.name
        if item.is_dir():
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)
    return True

VERIUM_PACKAGE_RECIPES = (
    "boost.mk",
    "bdb.mk",
    "openssl.mk",
    "curl.mk",
    "zlib.mk",
    "minizip.mk",
    "libevent.mk",
    "zeromq.mk",
)

def sync_verium_package_recipes() -> bool:
    """Overlay verium depends recipes (patches + mk must stay in sync)."""
    src_dir = verium_root / "depends/packages"
    dst_dir = root / "depends/packages"
    if not src_dir.is_dir() or not dst_dir.is_dir():
        print("==> WARN: verium depends/packages not found (sparse checkout?)")
        return False
    copied = []
    for name in VERIUM_PACKAGE_RECIPES:
        src = src_dir / name
        if src.is_file():
            shutil.copy2(src, dst_dir / name)
            copied.append(name)
    if copied:
        print("==> Synced depends package recipes:", ", ".join(copied))
        return True
    return False

changed = []
if sync_depends_patches():
    changed.append("depends/patches")
if sync_verium_package_recipes():
    changed.append("depends/packages/*.mk")
if patch_bdb():
    changed.append("depends/packages/bdb.mk")
if patch_boost():
    changed.append("depends/packages/boost.mk")
if patch_openssl():
    changed.append("depends/packages/openssl.mk")
if patch_package_registry():
    changed.append("depends/packages/packages.mk")
if patch_zeromq():
    changed.append("depends/packages/zeromq.mk")

if changed:
    print("==> Patched depends recipes:", ", ".join(changed))
else:
    print("==> Depends recipes already compatible")

zeromq_recipe = root / "depends/packages/zeromq.mk"
if zeromq_recipe.exists():
    print("==> Active zeromq recipe patch line(s):")
    for line in zeromq_recipe.read_text(encoding="utf-8").splitlines():
        if "_patches" in line or "remove_libstd_link" in line:
            print(line)
    if "remove_libstd_link.patch" in zeromq_recipe.read_text(encoding="utf-8"):
        raise SystemExit("zeromq.mk still references missing remove_libstd_link.patch")
PY
}

patch_depends_recipes_for_modern_toolchains

dump_curl_configure_snippet() {
  local cfg
  cfg="$(find depends/work/build -path "*/curl/*/configure" 2>/dev/null | head -1)" || true
  if [[ -z "$cfg" || ! -f "$cfg" ]]; then
    echo "=== curl configure snippet: no configure file found under depends/work/build ==="
    return 0
  fi
  echo "=== curl configure snippet (lines 7100-7155): $cfg ==="
  nl -ba "$cfg" | sed -n '7100,7155p' || true
}

build_depends() {
  local extra="${1:-}"
  if ! make -C depends HOST="$HOST" NO_QT=1 -j"$JOBS" $extra; then
    dump_curl_configure_snippet
    return 1
  fi
}

if [[ "$KIND" == "macos" ]]; then
  brew install automake libtool pkg-config || true
  python3 -m pip install --user --break-system-packages --upgrade pip setuptools wheel 2>/dev/null || true
fi

if [[ "$KIND" == "linux" || "$KIND" == "mingw" ]]; then
  ./autogen.sh
  export CONFIG_SITE="$(pwd)/depends/$HOST/share/config.site"
  EXTRA=""
  if [[ "$KIND" == "mingw" ]]; then
    EXTRA="RC=${HOST}-windres WINDRES=${HOST}-windres CC_FOR_BUILD=gcc CXX_FOR_BUILD=g++ ac_cv_search_clock_gettime=no"
  fi
  build_depends "$EXTRA"
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
  export CXXFLAGS="${CXXFLAGS:-} -Wno-enum-constexpr-conversion -Wno-error=enum-constexpr-conversion"
  case "$HOST" in
    aarch64-*) export MACOSX_DEPLOYMENT_TARGET=11.0 ;;
    *) export MACOSX_DEPLOYMENT_TARGET=10.15 ;;
  esac
  build_depends
  ./configure \
    --host="$HOST" \
    --prefix="$(pwd)/depends/$HOST" \
    --without-gui --disable-tests --disable-bench \
    --enable-reduce-exports --disable-shared --enable-static \
    $CONFIGURE_EXTRA
  if [[ "$(uname -s)" == "Darwin" ]]; then
    sed -i '' \
      -e 's/-DHAVE_WEAK_GETAUXVAL=1/-DHAVE_WEAK_GETAUXVAL=0/g' \
      -e 's/-DHAVE_STRONG_GETAUXVAL=1/-DHAVE_STRONG_GETAUXVAL=0/g' \
      -e 's/-DHAVE_ARM64_CRC32C=1/-DHAVE_ARM64_CRC32C=0/g' \
      src/Makefile
    rm -f src/crc32c/{*.o,*.a} 2>/dev/null || true
  fi
  make -j"$JOBS" src/vericoind
  mkdir -p "$OUT_BASE"
  cp src/vericoind "$OUT_BASE/vericoind-${TARGET}"
  chmod +x "$OUT_BASE/vericoind-${TARGET}"
  exit 0
fi

echo "Unsupported VERICOIND_CI_KIND=$KIND"
exit 1
