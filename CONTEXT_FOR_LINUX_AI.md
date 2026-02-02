# Verium Project Context - Linux Build Session

## Project Overview

**Project**: Verium (Cryptocurrency/Blockchain)
**Version**: 1.3.5
**Repository**: https://github.com/jayhines91/verium
**Current Branch**: `testnet`
**Latest Commit**: `e1d9999e0` - "Add Linux build scripts, macOS fixes, and transfer documentation"

## Current Objective

Build Linux binaries for both **x86_64** and **ARM64** architectures with Qt GUI support, organized into separate folders:
- `release-binaries/linux/x86/` - x86_64 binaries
- `release-binaries/linux/arm/` - ARM64 binaries

## What Has Been Completed

### 1. macOS Builds (Completed)
- ✅ Built macOS binaries with Qt GUI
- ✅ Fixed window dragging issue (window was moving with mouse cursor)
- ✅ Fixed minimize button crash (null pointer dereference)
- ✅ Restored original 1.3.5 color palette (dark blue theme)
- ✅ Binaries located in `release-binaries/macos/`

### 2. Linux Build Infrastructure (Ready)
- ✅ Created `build-linux-x86.sh` - x86_64 build script
- ✅ Created `build-linux-arm.sh` - ARM64 build script
- ✅ Created documentation (`LINUX_SETUP.md`, `BUILD_INSTRUCTIONS.md`)
- ✅ Created verification script (`verify-on-linux.sh`)
- ✅ Set up directory structure (`release-binaries/linux/x86/`, `release-binaries/linux/arm/`)

### 3. Code Fixes Applied
- ✅ Fixed `src/net.cpp` - Updated `UPNP_GetValidIGD` call for miniupnpc API compatibility
- ✅ Fixed `src/wallet/db.cpp` - Updated Boost filesystem API (`overwrite_existing`)
- ✅ Fixed `src/wallet/walletutil.cpp` - Removed deprecated `it.level()` call
- ✅ Fixed `src/qt/bitcoingui.cpp` - Window dragging and minimize button fixes
- ✅ Fixed `src/qt/bitcoingui.h` - Added `m_dragging` flag and `mouseReleaseEvent`

## Technical Details

### Dependencies Used
- **Qt**: 5.15.18 (with GUI support)
- **OpenSSL**: 1.1.1w (compatible with 1.0.1k requirement)
- **Protocol Buffers**: 3.21.12 (supports proto2, compatible with 2.6.3 requirement)
- **Boost**: 1.85.0_3
- **Berkeley DB**: 4.8.30
- **miniupnpc**: 2.3.3
- **libevent**: 2.1.12_1

### Build System
- Uses Autotools (`configure.ac`, `Makefile.am`)
- Uses `depends/` system for dependency management
- Cross-compilation via `HOST` environment variable

### Key Files Modified

**Source Code:**
- `src/net.cpp` - UPnP API fix
- `src/wallet/db.cpp` - Boost filesystem fix
- `src/wallet/walletutil.cpp` - Boost iterator fix
- `src/qt/bitcoingui.cpp` - Window dragging and minimize fixes
- `src/qt/bitcoingui.h` - MoveWindowControl class updates

**Build Scripts:**
- `build-linux-x86.sh` - x86_64 build automation
- `build-linux-arm.sh` - ARM64 build automation
- `verify-on-linux.sh` - Transfer verification

**Documentation:**
- `LINUX_SETUP.md` - Quick start guide
- `release-binaries/linux/README.md` - Overview
- `release-binaries/linux/BUILD_INSTRUCTIONS.md` - Detailed instructions

## Current Task: Build Linux Binaries

### Prerequisites Needed on Linux

**For x86_64:**
```bash
sudo apt-get update
sudo apt-get install -y \
    build-essential automake libtool pkg-config python3 \
    curl zip unzip ccache
```

**For ARM64 (cross-compilation):**
```bash
sudo apt-get install -y \
    g++-aarch64-linux-gnu \
    binutils-aarch64-linux-gnu \
    qemu-user-static
```

### Build Process

1. **Verify transfer:**
   ```bash
   ./verify-on-linux.sh
   ```

2. **Regenerate build system:**
   ```bash
   ./autogen.sh
   ```

3. **Build x86_64:**
   ```bash
   ./build-linux-x86.sh
   ```
   - Sets `HOST=x86_64-pc-linux-gnu`
   - Builds dependencies via `depends/` system
   - Configures with `--with-gui=qt5`
   - Copies binaries to `release-binaries/linux/x86/`

4. **Build ARM64:**
   ```bash
   ./build-linux-arm.sh
   ```
   - Sets `HOST=aarch64-linux-gnu`
   - Builds dependencies via `depends/` system
   - Configures with `--with-gui=qt5 --enable-glibc-back-compat`
   - Copies binaries to `release-binaries/linux/arm/`

### Expected Output

Each build should produce:
- `veriumd` - Daemon (headless node)
- `verium-cli` - Command-line interface
- `verium-tx` - Transaction tool
- `verium-wallet` - Wallet tool
- `verium-qt` - Qt GUI application

### Build Time Estimates
- First build: 30-60 minutes (depends on hardware)
- Subsequent builds: 10-20 minutes (if dependencies cached)
- Disk space: ~20GB required
- RAM: 8GB+ recommended

## Important Notes

### Dependency Versions
- **OpenSSL**: Must stay at 1.1.1w (user requirement: compatible with 1.0.1k)
- **Protocol Buffers**: Must stay at 3.21.12 (user requirement: compatible with 2.6.3)
- These will be upgraded later, not now

### Qt Version
- The `depends/packages/qt.mk` shows Qt 5.9.8
- However, we want Qt 5.15.18 for better macOS support
- The `depends` system may need to be updated, or we may need to use system Qt
- Check what Qt version gets built/used

### Build Flags Used
- `--with-gui=qt5` - Enable Qt GUI
- `--enable-reduce-exports` - Reduce symbol exports
- `--disable-bench` - Skip benchmark builds
- `--disable-tests` - Skip test builds
- `--enable-glibc-back-compat` - For ARM builds (compatibility)

### Potential Issues

1. **Qt Version Mismatch**: `depends/qt.mk` may specify 5.9.8, but we want 5.15.18
   - Solution: May need to update `depends/packages/qt.mk` or use system Qt

2. **Cross-compilation Toolchain**: ARM builds require `aarch64-linux-gnu-g++`
   - Verify: `aarch64-linux-gnu-g++ --version`

3. **Dependency Build Time**: First build downloads and compiles all dependencies
   - Be patient, this is normal

4. **Disk Space**: `depends/` system can use significant space
   - Monitor: `du -sh depends/`

## File Structure

```
verium/
├── build-linux-x86.sh          # x86_64 build script
├── build-linux-arm.sh           # ARM64 build script
├── verify-on-linux.sh           # Transfer verification
├── LINUX_SETUP.md               # Quick start guide
├── CONTEXT_FOR_LINUX_AI.md      # This file
├── src/                         # Source code
│   ├── qt/                      # Qt GUI source
│   │   ├── bitcoingui.cpp       # Main GUI (with fixes)
│   │   └── bitcoingui.h         # GUI header (with fixes)
│   ├── net.cpp                  # Network code (UPnP fix)
│   └── wallet/                  # Wallet code (Boost fixes)
├── depends/                     # Dependency build system
│   ├── packages/               # Package definitions
│   │   └── qt.mk               # Qt package (may need update)
│   └── hosts/                  # Host-specific configs
└── release-binaries/
    ├── linux/
    │   ├── x86/                # x86_64 binaries (created after build)
    │   └── arm/                # ARM64 binaries (created after build)
    └── macos/                  # macOS binaries (already built)
```

## Next Steps

1. **Pull latest code** (if not already done):
   ```bash
   git pull origin testnet
   ```

2. **Verify environment**:
   ```bash
   ./verify-on-linux.sh
   ```

3. **Install prerequisites** (see above)

4. **Build x86_64 binaries**:
   ```bash
   ./build-linux-x86.sh
   ```

5. **Build ARM64 binaries**:
   ```bash
   ./build-linux-arm.sh
   ```

6. **Verify binaries**:
   ```bash
   ls -lh release-binaries/linux/x86/
   ls -lh release-binaries/linux/arm/
   file release-binaries/linux/x86/verium-qt
   file release-binaries/linux/arm/verium-qt
   ```

## Troubleshooting

### Build fails at configure step
- Check `config.log` for details
- Ensure `./autogen.sh` was run
- Verify all prerequisites installed

### Qt not found
- Check if `depends` system built Qt
- May need to update `depends/packages/qt.mk` for Qt 5.15.18
- Or configure to use system Qt if available

### Cross-compilation fails
- Verify `aarch64-linux-gnu-g++` is installed and in PATH
- Check `depends/${HOST}/share/config.site` exists
- May need to set `CONFIG_SITE` environment variable

### Out of disk space
- Clean old builds: `make clean`
- Remove old dependencies: `rm -rf depends/built/${HOST}`
- Check available space: `df -h`

## Contact/Context

- **Previous work**: Done on macOS, fixes applied and tested
- **Current goal**: Build Linux binaries for both architectures
- **User preference**: Keep OpenSSL 1.1.1w and Protobuf 3.21.12 (upgrade later)
- **Qt requirement**: 5.15.18 preferred (but may need to work with what `depends` provides)

## Success Criteria

✅ x86_64 binaries built and in `release-binaries/linux/x86/`
✅ ARM64 binaries built and in `release-binaries/linux/arm/`
✅ All binaries include Qt GUI (`verium-qt`)
✅ Binaries are executable and properly linked
✅ File command shows correct architecture

---

**Ready to proceed with Linux builds!**
