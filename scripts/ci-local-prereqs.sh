#!/usr/bin/env bash
# Print what is installed vs missing for local desktop-app CI (WSL).
set -uo pipefail

if grep -qi microsoft /proc/version 2>/dev/null; then
  export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
fi

ok() { printf '  [ok]   %s\n' "$*"; }
miss() { printf '  [MISS] %s\n' "$*"; }

echo "WSL prerequisites for verium desktop-app CI"
echo ""

have() { command -v "$1" >/dev/null 2>&1; }

for cmd in make gcc g++ autoconf automake libtool pkg-config python3 curl; do
  have "$cmd" && ok "$cmd" || miss "$cmd (build-essential, autotools)"
done

have aarch64-linux-gnu-g++ && ok aarch64-linux-gnu-g++ || \
  miss "aarch64-linux-gnu-g++ (sudo apt install gcc-aarch64-linux-gnu g++-aarch64-linux-gnu)"
have x86_64-w64-mingw32-g++ && ok x86_64-w64-mingw32-g++ || \
  miss "x86_64-w64-mingw32-g++ (sudo apt install g++-mingw-w64-x86-64 binutils-mingw-w64-x86-64)"

dpkg -l libwebkit2gtk-4.1-dev >/dev/null 2>&1 && ok libwebkit2gtk-4.1-dev || \
  miss "libwebkit2gtk-4.1-dev (Linux wallet; sudo apt install libwebkit2gtk-4.1-dev ...)"

have node && ok "node $(node -v 2>/dev/null)" || miss "node (wallet; nodesource Node 20 or --install-deps)"
have cargo && ok "cargo $(cargo -V 2>/dev/null)" || miss "cargo (wallet; rustup or --install-deps)"

if sudo -n true 2>/dev/null; then
  ok "passwordless sudo (apt install works from scripts)"
else
  miss "passwordless sudo — run apt installs manually once, or: echo '\$USER ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/$USER"
fi

echo ""
echo "One-time install (paste in WSL, enter password when prompted):"
cat <<'EOF'
sudo apt-get update && sudo apt-get install -y \
  build-essential libtool autotools-dev automake pkg-config \
  bsdmainutils python3 curl ca-certificates \
  gcc-aarch64-linux-gnu g++-aarch64-linux-gnu \
  g++-mingw-w64-x86-64 binutils-mingw-w64-x86-64 \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
  libssl-dev libgtk-3-dev libfuse2 xdg-utils
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
source ~/.cargo/env
EOF

echo ""
echo "Then run:"
echo "  ./scripts/ci-local-all.sh --sidecars-only"
echo "  ./scripts/ci-local-all.sh                    # + Linux wallet"
echo "  powershell -File scripts/ci-local.ps1 -Phase wallet -SkipSidecarBuild"
