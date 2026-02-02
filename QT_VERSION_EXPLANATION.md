# Qt Version Upgrade Explanation: 5.9.8 → 5.15.18

## Summary

**For macOS**: Used **system Qt 5.15.18** via Homebrew (NOT the depends system)  
**depends/qt.mk**: Still shows **5.9.8** (unchanged)  
**Linux builds**: Will use **Qt 5.9.8** from depends system (unless updated)

## What Actually Happened on macOS

### Method: System Installation, NOT Depends

1. **Qt Installation**:
   ```bash
   brew install qt@5  # Installs Qt 5.15.18
   ```
   - Location: `/usr/local/Cellar/qt@5/5.15.18/`
   - Provides: `qmake`, `pkg-config` files, frameworks

2. **Configure Script Detection**:
   The `configure.ac` script has special macOS handling (lines 532-561):
   ```autoconf
   *darwin*)
     AC_CHECK_PROG([BREW],brew, brew)
     if test x$BREW = xbrew; then
       qt5_prefix=`$BREW --prefix qt5 2>/dev/null`
       if test x$qt5_prefix != x; then
         PKG_CONFIG_PATH="$qt5_prefix/lib/pkgconfig:$PKG_CONFIG_PATH"
         export PKG_CONFIG_PATH
       fi
     fi
   ```
   - Detects Homebrew Qt via `brew --prefix qt5`
   - Adds Qt's pkg-config path to `PKG_CONFIG_PATH`
   - Configure then finds Qt 5.15.18 via pkg-config

3. **Build Process**:
   ```bash
   ./configure --with-gui=qt5
   ```
   - Configure finds `/usr/local/opt/qt@5/bin/qmake`
   - Uses Qt 5.15.18 frameworks from Homebrew
   - **Does NOT use depends/qt.mk** (depends system skipped for Qt)

4. **Verification**:
   ```bash
   otool -L src/qt/verium-qt | grep Qt
   ```
   Shows:
   ```
   /usr/local/opt/qt@5/lib/QtCore.framework/Versions/5/QtCore (version 5.15.18)
   /usr/local/opt/qt@5/lib/QtGui.framework/Versions/5/QtGui (version 5.15.18)
   /usr/local/opt/qt@5/lib/QtWidgets.framework/Versions/5/QtWidgets (version 5.15.18)
   /usr/local/opt/qt@5/lib/QtNetwork.framework/Versions/5/QtNetwork (version 5.15.18)
   ```

### Why This Works

- **macOS**: Configure script prioritizes system Qt over depends Qt
- **depends/qt.mk**: Only used if system Qt not found
- **Result**: macOS got Qt 5.15.18 without modifying depends/qt.mk

## Current State

### macOS (Completed)
- ✅ Qt 5.15.18 (system install via Homebrew)
- ✅ Binary linked to `/usr/local/opt/qt@5/lib/Qt*.framework`
- ✅ `depends/qt.mk` unchanged (still 5.9.8)

### Linux (Pending)
- ⏳ Will use `depends/qt.mk` → Qt 5.9.8
- ⏳ Unless we update `depends/qt.mk` or use system Qt

## Options for Linux Builds

### Option 1: Update depends/qt.mk to 5.15.18 (Recommended)

**Pros:**
- Consistent version across macOS and Linux
- Reproducible builds
- No system dependencies

**Cons:**
- Need to update qt.mk file
- Need Qt 5.15.18 download URLs and SHA256 hashes
- May need to update patches

**Steps:**
1. Update `depends/packages/qt.mk`:
   ```makefile
   $(package)_version=5.15.18
   $(package)_download_path=https://download.qt.io/official_releases/qt/5.15/5.15.18/submodules
   $(package)_sha256_hash=<get_from_qt_website>
   ```
2. Update qttools and qttranslations hashes
3. Test patches compatibility
4. Rebuild: `make -C depends HOST=x86_64-pc-linux-gnu`

### Option 2: Use System Qt on Linux

**Pros:**
- Quick (if Qt already installed)
- No depends modification needed

**Cons:**
- Requires Qt 5.15.18 installed system-wide
- Less reproducible
- Different from macOS approach

**Steps:**
1. Install Qt 5.15.18 on Linux system
2. Configure with `--with-gui=qt5`
3. Skip depends Qt: `make -C depends HOST=x86_64-pc-linux-gnu NO_QT=1`

### Option 3: Keep Qt 5.9.8 for Linux

**Pros:**
- No changes needed
- Works immediately

**Cons:**
- Version mismatch (macOS 5.15.18 vs Linux 5.9.8)
- Missing newer Qt features/bug fixes

## Recommendation

**Update depends/qt.mk to Qt 5.15.18** for consistency. This ensures:
- Same Qt version on macOS and Linux
- Reproducible builds
- Access to Qt 5.15.18 features and fixes

## Files Involved

- **depends/packages/qt.mk** - Qt package definition (currently 5.9.8)
- **configure.ac** - Configure script (detects system Qt on macOS)
- **build-linux-*.sh** - Build scripts (will use depends Qt)

## Verification Commands

**macOS (current):**
```bash
otool -L release-binaries/macos/Verium-Qt.app/Contents/MacOS/Verium-Qt | grep Qt
# Shows: version 5.15.18
```

**Linux (after build):**
```bash
ldd release-binaries/linux/x86/verium-qt | grep Qt
# or
readelf -d release-binaries/linux/x86/verium-qt | grep Qt
```

## Conclusion

**macOS**: Used system Qt 5.15.18 (Homebrew), bypassed depends system  
**Linux**: Will use depends Qt 5.9.8 unless we update `depends/qt.mk`  
**Action needed**: Update `depends/packages/qt.mk` to 5.15.18 for consistency
