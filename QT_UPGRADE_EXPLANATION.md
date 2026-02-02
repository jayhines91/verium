# Qt Upgrade Explanation: 5.9.8 → 5.15.18

## What Actually Happened

### For macOS Build (Completed)
- **Method**: System installation via Homebrew, NOT depends system
- **Qt Version**: 5.15.18 installed via `brew install qt@5`
- **Location**: `/usr/local/Cellar/qt@5/5.15.18/`
- **Linking**: Configure script detected and used system Qt
- **depends/qt.mk**: NOT modified (still shows 5.9.8)

### How It Works

1. **System Qt Detection**:
   - The `configure` script checks for Qt via `pkg-config` or `qmake`
   - Homebrew's Qt 5.15.18 provides these tools in PATH
   - Configure finds system Qt before checking depends

2. **Build Configuration**:
   ```bash
   ./configure --with-gui=qt5
   ```
   - This flag tells configure to look for Qt5
   - It finds `/usr/local/Cellar/qt@5/5.15.18/bin/qmake`
   - Uses system Qt libraries and headers

3. **No depends/qt.mk Modification**:
   - The `depends/` system was NOT used for Qt on macOS
   - `depends/packages/qt.mk` still specifies Qt 5.9.8
   - This is fine because we're using system Qt, not depends Qt

## For Linux Builds (Pending)

### Current Situation
- `depends/packages/qt.mk` specifies Qt 5.9.8
- Linux builds will use the `depends` system
- This means Linux will get Qt 5.9.8, NOT 5.15.18

### Options for Linux

**Option 1: Update depends/qt.mk (Recommended)**
- Modify `depends/packages/qt.mk` to use Qt 5.15.18
- Update version, download URL, and SHA256 hash
- Let depends system build Qt 5.15.18

**Option 2: Use System Qt**
- Install Qt 5.15.18 system-wide on Linux
- Configure with `--with-gui=qt5` (will find system Qt)
- Skip depends Qt build with `NO_QT=1`

**Option 3: Keep Qt 5.9.8**
- Leave depends/qt.mk as-is
- Use Qt 5.9.8 for Linux builds
- Accept version difference between macOS and Linux

## Recommendation

For consistency, **update depends/qt.mk** to Qt 5.15.18 so both macOS and Linux use the same version.

### Steps to Update depends/qt.mk:

1. Find Qt 5.15.18 download URL and SHA256
2. Update `depends/packages/qt.mk`:
   ```makefile
   $(package)_version=5.15.18
   $(package)_download_path=https://download.qt.io/official_releases/qt/5.15/5.15.18/submodules
   $(package)_sha256_hash=<new_hash>
   ```
3. Rebuild dependencies: `make -C depends HOST=x86_64-pc-linux-gnu NO_QT=0`

## Current State

- **macOS**: Qt 5.15.18 (system install, Homebrew)
- **Linux (planned)**: Qt 5.9.8 (depends system, unless updated)
- **depends/qt.mk**: Still shows 5.9.8

## Verification

To check which Qt version is being used:
```bash
# macOS (already built)
otool -L src/qt/verium-qt | grep Qt

# Linux (after build)
ldd src/qt/verium-qt | grep Qt
# or
readelf -d src/qt/verium-qt | grep Qt
```
