# Qt Static Linking: System Qt vs Depends Qt

## Short Answer

**System Qt on Linux**: Usually **NO** - Most distributions only provide shared libraries  
**Depends Qt**: **YES** - Built with `-static` flag, produces static libraries

## How Static Linking Works

### Depends System (Current Approach)

The `depends/packages/qt.mk` file builds Qt with:
```makefile
$(package)_config_opts += -static
```

This means:
- ✅ Qt is built as **static libraries** (`.a` files)
- ✅ Your binary links Qt code directly into the executable
- ✅ No Qt runtime dependencies needed
- ✅ Self-contained binaries

### System Qt (Alternative Approach)

Most Linux distributions provide Qt as:
- **Shared libraries** (`.so` files) - `/usr/lib/x86_64-linux-gnu/libQt5Core.so`
- **No static libraries** - Static `.a` files are rarely included

If you use system Qt:
- ❌ Binary will link to `.so` files dynamically
- ❌ Users need Qt installed on their system
- ❌ Version mismatches can cause issues
- ⚠️ **Not portable** - requires matching Qt version on target system

## Can System Qt Be Static?

### Option 1: Use System Qt Static Libraries (If Available)

**Rare but possible:**
```bash
# Check if static libraries exist
ls /usr/lib/x86_64-linux-gnu/libQt5Core.a
ls /usr/lib/x86_64-linux-gnu/libQt5Gui.a
ls /usr/lib/x86_64-linux-gnu/libQt5Widgets.a
```

If they exist, you can force static linking:
```bash
./configure --with-gui=qt5 \
    LDFLAGS="-static-libgcc -static-libstdc++" \
    QT5_LIBS="-lQt5Core -lQt5Gui -lQt5Widgets -lQt5Network"
```

**Reality**: Most distributions don't provide static Qt libraries.

### Option 2: Build Your Own Static Qt

You could build Qt statically from source:
```bash
# Download Qt 5.15.18 source
wget https://download.qt.io/official_releases/qt/5.15/5.15.18/single/qt-everywhere-opensource-src-5.15.18.tar.xz

# Configure with -static
./configure -static -prefix /opt/qt5-static -opensource -confirm-license

# Then point configure to it
./configure --with-gui=qt5 \
    QT5_CFLAGS="-I/opt/qt5-static/include" \
    QT5_LIBS="-L/opt/qt5-static/lib -lQt5Core -lQt5Gui ..."
```

**Downside**: This is essentially what the `depends` system does, but manually.

### Option 3: Use Depends System (Recommended)

The `depends` system:
- ✅ Builds Qt statically automatically
- ✅ Handles all dependencies
- ✅ Reproducible builds
- ✅ No system Qt required

## How Configure Detects Static Qt

The configure script checks if Qt is static:

```autoconf
_BITCOIN_QT_IS_STATIC
if test "x$bitcoin_cv_static_qt" = xyes; then
    # Link static plugins
fi
```

It checks Qt headers/config to determine if Qt was built statically.

## Current Build Scripts

### build-linux-x86.sh / build-linux-arm.sh

These scripts use:
```bash
export CONFIG_SITE=$(pwd)/depends/${HOST}/share/config.site
./configure --prefix=$(pwd)/depends/${HOST} --with-gui=qt5
```

This means:
- Uses `depends` system Qt (static)
- `CONFIG_SITE` points to depends config
- Configure finds Qt from depends, not system

### If You Want System Qt Instead

You'd need to:
1. **Skip depends Qt**:
   ```bash
   make -C depends HOST=x86_64-pc-linux-gnu NO_QT=1
   ```

2. **Don't use CONFIG_SITE**:
   ```bash
   unset CONFIG_SITE
   ./configure --with-gui=qt5
   ```

3. **Accept dynamic linking**:
   - Binary will link to system Qt `.so` files
   - Users need Qt installed

## Verification

### Check if Binary is Static or Dynamic

**After building:**
```bash
# Check Qt linking
ldd release-binaries/linux/x86/verium-qt | grep Qt

# If static: No Qt libraries listed (or only system libs)
# If dynamic: Shows libQt5Core.so, libQt5Gui.so, etc.
```

**Static linking (depends Qt):**
```
# No Qt .so files listed, or only system libraries
```

**Dynamic linking (system Qt):**
```
libQt5Core.so.5 => /usr/lib/x86_64-linux-gnu/libQt5Core.so.5
libQt5Gui.so.5 => /usr/lib/x86_64-linux-gnu/libQt5Gui.so.5
libQt5Widgets.so.5 => /usr/lib/x86_64-linux-gnu/libQt5Widgets.so.5
```

## Recommendation

**Use the depends system** for Linux builds because:
1. ✅ Guaranteed static linking
2. ✅ No system dependencies
3. ✅ Reproducible builds
4. ✅ Works across different Linux distributions
5. ✅ Self-contained binaries

**Don't use system Qt** unless:
- You specifically need dynamic linking
- You're building for a specific distribution
- You can guarantee Qt version compatibility

## Summary

| Method | Static Linking | Portability | Complexity |
|--------|---------------|-------------|------------|
| **Depends Qt** | ✅ Yes | ✅ High | ✅ Easy (automatic) |
| **System Qt** | ❌ No (usually) | ❌ Low | ⚠️ Medium |
| **Custom Static Qt** | ✅ Yes | ✅ High | ❌ Hard (manual build) |

**Answer**: System Qt on Linux typically cannot be statically linked because distributions don't provide static libraries. Use the depends system for static linking.
