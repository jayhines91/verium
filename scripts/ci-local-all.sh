#!/usr/bin/env bash
# Run every desktop-app target that can be built from WSL + native Windows.
#
#   ./scripts/ci-local-all.sh                  # all sidecars + Linux x64 wallet
#   ./scripts/ci-local-all.sh --sidecars-only  # sidecars only (faster)
#   ./scripts/ci-local-all.sh --install-deps   # apt + node + rust first
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/ci-local.sh"
SIDECARS_ONLY=0
INSTALL=0
EXTRA=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sidecars-only) SIDECARS_ONLY=1; shift ;;
    --install-deps) INSTALL=1; shift ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done

declare -A RESULT=()
FAILED=0

run_sidecar() {
  local target="$1"
  local out="$ROOT/out/veriumd-$target"
  [[ "$target" == *windows* ]] && out="$ROOT/out/veriumd-$target.exe"
  if [[ -f "$out" ]]; then
    echo "[skip] sidecar exists: $out"
    RESULT["$target"]=skipped
    return 0
  fi
  local skip_dep=""
  local host
  case "$target" in
    x86_64-unknown-linux-gnu) host=x86_64-linux-gnu ;;
    aarch64-unknown-linux-gnu) host=aarch64-linux-gnu ;;
    x86_64-pc-windows-msvc) host=x86_64-w64-mingw32 ;;
  esac
  if [[ -f "$ROOT/depends/$host/share/config.site" ]]; then
    skip_dep="--skip-depends"
  fi
  if "$SCRIPT" --target "$target" --phase sidecar $skip_dep "${EXTRA[@]}"; then
    RESULT["$target"]=ok
  else
    RESULT["$target"]=FAIL
    FAILED=1
  fi
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

[[ "$INSTALL" == "1" ]] && {
  "$SCRIPT" --install-deps --deps-only --target x86_64-unknown-linux-gnu --phase sidecar
  "$SCRIPT" --install-deps --deps-only --target aarch64-unknown-linux-gnu --phase sidecar
  install_node_rust_wsl
}

echo "========== Sidecars (WSL) =========="
for target in \
  x86_64-unknown-linux-gnu \
  aarch64-unknown-linux-gnu \
  x86_64-pc-windows-msvc; do
  echo "--- $target ---"
  run_sidecar "$target" || true
done

if [[ "$SIDECARS_ONLY" == "0" ]]; then
  echo "========== Linux x64 wallet (WSL) =========="
  if "$SCRIPT" --target x86_64-unknown-linux-gnu --phase wallet \
      --skip-sidecar-build --skip-depends "${EXTRA[@]}"; then
    RESULT["wallet-x86_64-linux"]=ok
  else
    RESULT["wallet-x86_64-linux"]=FAIL
    FAILED=1
  fi
fi

echo ""
echo "========== Summary =========="
for k in x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu x86_64-pc-windows-msvc wallet-x86_64-linux; do
  [[ -n "${RESULT[$k]+x}" ]] || continue
  printf "  %-32s %s\n" "$k" "${RESULT[$k]}"
done
echo ""
echo "Native Windows wallet (after MinGW sidecar):"
echo "  powershell -File scripts/ci-local.ps1 -Phase wallet -SkipSidecarBuild"
echo ""
echo "macOS (requires a Mac):"
echo "  ./scripts/ci-local.sh --target x86_64-apple-darwin --phase sidecar --install-deps"
echo "  ./scripts/ci-local.sh --target aarch64-apple-darwin --phase sidecar --install-deps"

exit "$FAILED"
