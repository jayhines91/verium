# Linux Build Setup Guide

## Quick Start

### 1. Transfer Code (from macOS)

**Option A: Git (Recommended)**
```bash
# On macOS - commit and push
git add .
git commit -m "Add Linux build scripts and macOS fixes"
git push origin testnet

# On Linux - clone or pull
git clone https://github.com/jayhines91/verium.git
cd verium
git checkout testnet
# OR if already cloned:
git pull origin testnet
```

**Option B: Direct Transfer**
```bash
# On macOS - create tarball
cd /Users/jay/Code\ Workspace/verium-1.3.5.1/testnet
tar -czf verium-transfer.tar.gz verium/

# Transfer to Linux (adjust host/path)
scp verium-transfer.tar.gz user@linux-box:/path/to/destination/

# On Linux - extract
cd /path/to/destination
tar -xzf verium-transfer.tar.gz
cd verium
```

### 2. Verify Transfer

```bash
./verify-on-linux.sh
```

### 3. Install Prerequisites

**For x86_64 builds:**
```bash
sudo apt-get update
sudo apt-get install -y \
    build-essential automake libtool pkg-config python3 \
    curl zip unzip ccache
```

**For ARM64 builds (additional):**
```bash
sudo apt-get install -y \
    g++-aarch64-linux-gnu \
    binutils-aarch64-linux-gnu \
    qemu-user-static
```

### 4. Regenerate Build System

```bash
./autogen.sh
```

### 5. Build

**x86_64:**
```bash
./build-linux-x86.sh
```

**ARM64:**
```bash
./build-linux-arm.sh
```

## What Gets Built

Each build creates binaries in:
- `release-binaries/linux/x86/` - x86_64 binaries
- `release-binaries/linux/arm/` - ARM64 binaries

Binaries included:
- `veriumd` - Daemon
- `verium-cli` - CLI
- `verium-tx` - Transaction tool
- `verium-wallet` - Wallet tool
- `verium-qt` - Qt GUI application

## Troubleshooting

### Build fails with "configure: error"
- Run `./autogen.sh` first
- Check `config.log` for details

### Missing dependencies
- The `depends` system will download and build most dependencies automatically
- First build may take 30-60 minutes

### Cross-compilation issues
- Ensure cross-compiler is in PATH
- Check with: `aarch64-linux-gnu-g++ --version`

## Notes

- Build time: 30-60 minutes (first build)
- Disk space: ~20GB required
- RAM: 8GB+ recommended
- The `depends` system handles Qt 5.15.18 and all dependencies automatically
