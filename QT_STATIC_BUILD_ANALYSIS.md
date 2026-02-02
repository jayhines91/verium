# Qt 5.15.18 Static Linking Analysis

## Short Answer: **YES, Qt 5.15.18 CAN be statically linked**

Qt 5.15.18 fully supports static linking. You need to build Qt from source with the `-static` flag.

## How Static Linking Works

### Qt Build Configuration

Qt supports static linking via the `-static` configure flag:

```bash
./configure -static -prefix /path/to/qt-static -opensource -confirm-license
```

This builds Qt as static libraries (`.a` files) instead of shared libraries (`.so`/`.dylib`/`.dll`).

### Current State

**Linux (depends system):**
- ✅ `depends/packages/qt.mk` includes: `$(package)_config_opts += -static`
- ✅ Qt will be built statically
- ✅ Binaries will be statically linked

**macOS (current):**
- ❌ Using Homebrew Qt (shared frameworks)
- ❌ Binary is dynamically linked
- ⚠️ Can be made static by building Qt statically

## Options for Static Qt on macOS

### Option 1: Use Depends System (Like Linux)

Build Qt via depends system:
```bash
# Build Qt statically via depends
make -C depends HOST=x86_64-apple-darwin

# Configure to use depends Qt
export CONFIG_SITE=$(pwd)/depends/x86_64-apple-darwin/share/config.site
./configure --prefix=$(pwd)/depends/x86_64-apple-darwin --with-gui=qt5
```

**Pros:**
- ✅ Consistent with Linux approach
- ✅ Guaranteed static linking
- ✅ Reproducible builds

**Cons:**
- ⏱️ Long build time (Qt compilation takes hours)
- 💾 Large disk space requirement

### Option 2: Build Static Qt Manually

Build Qt 5.15.18 statically from source:

```bash
# Download Qt source
wget https://download.qt.io/official_releases/qt/5.15/5.15.18/single/qt-everywhere-opensource-src-5.15.18.tar.xz
tar -xf qt-everywhere-opensource-src-5.15.18.tar.xz
cd qt-everywhere-opensource-src-5.15.18

# Configure for static build
./configure \
    -static \
    -prefix /opt/qt5-static \
    -opensource \
    -confirm-license \
    -release \
    -no-opengl \
    -no-dbus \
    -nomake examples \
    -nomake tests

# Build (takes several hours)
make -j$(sysctl -n hw.ncpu)

# Install
sudo make install
```

Then configure Verium to use it:
```bash
./configure --with-gui=qt5 \
    QT5_CFLAGS="-I/opt/qt5-static/include" \
    QT5_LIBS="-L/opt/qt5-static/lib -lQt5Core -lQt5Gui ..."
```

**Pros:**
- ✅ Full control over Qt build
- ✅ Can customize Qt features

**Cons:**
- ❌ Very time-consuming (4-8 hours)
- ❌ Complex configuration
- ❌ Large disk space

### Option 3: Keep Dynamic (Current)

Use dynamic linking and bundle frameworks:
```bash
make deploy  # Bundles Qt frameworks into .app
```

**Pros:**
- ✅ Quick (uses existing Homebrew Qt)
- ✅ Standard macOS approach
- ✅ `make deploy` handles bundling

**Cons:**
- ❌ Larger `.app` bundle size
- ❌ Requires `make deploy` step

## Comparison

| Method | Static? | Build Time | Bundle Size | Complexity |
|--------|---------|------------|-------------|------------|
| **Depends Qt** | ✅ Yes | 4-8 hours | Small | ✅ Easy |
| **Manual Static Qt** | ✅ Yes | 4-8 hours | Small | ❌ Hard |
| **Dynamic + Deploy** | ❌ No | Minutes | Large | ✅ Easy |

## Recommendation

**For macOS:**
- **Quick solution**: Use `make deploy` to bundle frameworks (dynamic, but portable)
- **Long-term**: Use depends system for static linking (consistent with Linux)

**For Linux:**
- ✅ Already configured for static linking via depends system
- ✅ No changes needed

## Technical Details

### Qt Static Build Requirements

When building Qt statically, you need:
1. **Static dependencies**: OpenSSL, zlib, etc. must also be static
2. **Plugin linking**: Static Qt requires plugins to be linked into binary
3. **Feature flags**: Some Qt features may need to be disabled

### Depends System Static Build

The `depends/packages/qt.mk` handles this automatically:
- Builds dependencies statically
- Configures Qt with `-static`
- Links plugins statically
- Handles all the complexity

## Verification

After building with static Qt:
```bash
# macOS
otool -L verium-qt | grep Qt
# Should show NO Qt frameworks (or only system frameworks)

# Linux
ldd verium-qt | grep Qt
# Should show NO Qt libraries
```

## Conclusion

**Yes, Qt 5.15.18 can be statically linked**, but:
- Requires building Qt from source with `-static` flag
- The depends system does this automatically for Linux
- For macOS, you can either use depends system or build Qt manually
- Current macOS build uses dynamic linking (Homebrew Qt)
