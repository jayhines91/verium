# macOS Qt Linking Analysis

## Result: **DYNAMIC LINKING**

The macOS binary is **dynamically linked** to Qt frameworks.

## Evidence

From `otool -L` output, the binary links to:

```
/usr/local/opt/qt@5/lib/QtCore.framework/Versions/5/QtCore (version 5.15.18)
/usr/local/opt/qt@5/lib/QtGui.framework/Versions/5/QtGui (version 5.15.18)
/usr/local/opt/qt@5/lib/QtWidgets.framework/Versions/5/QtWidgets (version 5.15.18)
/usr/local/opt/qt@5/lib/QtNetwork.framework/Versions/5/QtNetwork (version 5.15.18)
/usr/local/opt/qt@5/lib/QtDBus.framework/Versions/5/QtDBus (version 5.15.18)
```

## Why Dynamic Linking?

1. **System Qt from Homebrew**: We used `/usr/local/opt/qt@5/` which provides frameworks (dynamic libraries)
2. **macOS Framework System**: Frameworks are macOS's way of packaging dynamic libraries
3. **No Static Option**: Homebrew Qt is built as shared frameworks, not static libraries

## Other Dynamic Dependencies

The binary also dynamically links to:
- Boost libraries (`libboost_system.dylib`, etc.)
- Berkeley DB (`libdb_cxx-4.8.dylib`)
- OpenSSL (`libcrypto.1.1.dylib`)
- libevent (`libevent-2.1.7.dylib`)
- miniupnpc (`libminiupnpc.21.dylib`)
- System libraries (libSystem, Foundation, AppKit, etc.)

## Implications

### Current State
- ✅ Binary works on your Mac (Qt frameworks are installed)
- ⚠️ Binary may not work on other Macs without Qt installed
- ⚠️ Requires Qt 5.15.18 frameworks at runtime

### For Distribution

**Option 1: Bundle Frameworks (Recommended for macOS)**
Use `make deploy` or manually copy Qt frameworks into `.app` bundle:
```bash
# Frameworks should be in:
Verium-Qt.app/Contents/Frameworks/QtCore.framework
Verium-Qt.app/Contents/Frameworks/QtGui.framework
# etc.
```

**Option 2: Require Qt Installation**
Users must install Qt 5.15.18 via Homebrew

**Option 3: Build Static Qt (Complex)**
- Build Qt statically from source
- Link statically
- Much larger binary, but self-contained

## Comparison: macOS vs Linux

| Platform | Qt Source | Linking | Portability |
|----------|-----------|---------|-------------|
| **macOS (current)** | System Qt (Homebrew) | Dynamic | ⚠️ Requires Qt installed |
| **Linux (planned)** | Depends Qt | Static | ✅ Self-contained |

## Recommendation

For macOS distribution, use `make deploy` to bundle Qt frameworks into the `.app` bundle. This makes it self-contained and portable.

## Verification Commands

```bash
# Check Qt linking
otool -L Verium-Qt.app/Contents/MacOS/Verium-Qt | grep Qt

# Check if frameworks are bundled
ls -la Verium-Qt.app/Contents/Frameworks/ 2>/dev/null || echo "No Frameworks directory"
```
