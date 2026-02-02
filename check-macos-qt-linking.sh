#!/bin/bash
echo "=== Checking Qt Linking in macOS Binary ==="
echo ""

BINARY="release-binaries/macos/Verium-Qt.app/Contents/MacOS/Verium-Qt"

if [ ! -f "$BINARY" ]; then
    echo "❌ Binary not found: $BINARY"
    exit 1
fi

echo "Binary: $BINARY"
echo ""

echo "=== All Qt Dependencies ==="
QT_DEPS=$(otool -L "$BINARY" | grep -i qt)
if [ -z "$QT_DEPS" ]; then
    echo "✅ No Qt dynamic libraries found - STATIC LINKING"
    STATIC=true
else
    echo "$QT_DEPS"
    STATIC=false
fi

echo ""
echo "=== Analysis ==="
if [ "$STATIC" = true ]; then
    echo "✅ STATIC LINKING: Qt code is compiled into the binary"
    echo "   - No Qt runtime dependencies needed"
    echo "   - Self-contained binary"
else
    echo "⚠️  DYNAMIC LINKING: Binary links to Qt frameworks"
    echo ""
    echo "Qt frameworks found:"
    echo "$QT_DEPS" | while read line; do
        if [[ $line == *"Qt"* ]]; then
            echo "  - $line"
        fi
    done
    echo ""
    echo "Location: /usr/local/opt/qt@5/lib/"
    echo "This means Qt 5.15.18 frameworks are required at runtime"
fi

echo ""
echo "=== Full Dependency List (first 20) ==="
otool -L "$BINARY" | head -20
