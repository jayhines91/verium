#!/bin/bash
# Quick verification script to run on Linux after transfer

echo "=== Verifying Verium codebase on Linux ==="
echo ""

ERRORS=0

# Check essential files
echo "Checking essential files..."
[ -f "build-linux-x86.sh" ] && echo "✅ build-linux-x86.sh" || { echo "❌ Missing build-linux-x86.sh"; ((ERRORS++)); }
[ -f "build-linux-arm.sh" ] && echo "✅ build-linux-arm.sh" || { echo "❌ Missing build-linux-arm.sh"; ((ERRORS++)); }
[ -f "configure.ac" ] && echo "✅ configure.ac" || { echo "❌ Missing configure.ac"; ((ERRORS++)); }
[ -d "src/qt" ] && echo "✅ src/qt/" || { echo "❌ Missing src/qt/"; ((ERRORS++)); }
[ -d "depends" ] && echo "✅ depends/" || { echo "❌ Missing depends/"; ((ERRORS++)); }
[ -d "release-binaries/linux" ] && echo "✅ release-binaries/linux/" || { echo "❌ Missing release-binaries/linux/"; ((ERRORS++)); }
echo ""

# Check build scripts are executable
echo "Checking build scripts..."
[ -x "build-linux-x86.sh" ] && echo "✅ build-linux-x86.sh is executable" || { echo "⚠️  Making build-linux-x86.sh executable..."; chmod +x build-linux-x86.sh; }
[ -x "build-linux-arm.sh" ] && echo "✅ build-linux-arm.sh is executable" || { echo "⚠️  Making build-linux-arm.sh executable..."; chmod +x build-linux-arm.sh; }
echo ""

# Check for required tools
echo "Checking build tools..."
command -v g++ >/dev/null 2>&1 && echo "✅ g++ found" || { echo "❌ g++ not found - install: sudo apt-get install build-essential"; ((ERRORS++)); }
command -v make >/dev/null 2>&1 && echo "✅ make found" || { echo "❌ make not found"; ((ERRORS++)); }
command -v autoconf >/dev/null 2>&1 && echo "✅ autoconf found" || { echo "⚠️  autoconf not found - may need: sudo apt-get install autoconf automake libtool"; }
echo ""

# Check for cross-compilers (optional)
echo "Checking cross-compilation tools (optional)..."
command -v aarch64-linux-gnu-g++ >/dev/null 2>&1 && echo "✅ ARM64 cross-compiler found" || echo "⚠️  ARM64 cross-compiler not found (needed for ARM builds)"
echo ""

if [ $ERRORS -eq 0 ]; then
    echo "✅ All essential files present!"
    echo ""
    echo "Next steps:"
    echo "1. Install prerequisites: sudo apt-get install build-essential automake libtool pkg-config python3 curl"
    echo "2. For ARM builds: sudo apt-get install g++-aarch64-linux-gnu binutils-aarch64-linux-gnu"
    echo "3. Run: ./autogen.sh"
    echo "4. Build: ./build-linux-x86.sh or ./build-linux-arm.sh"
else
    echo "❌ Found $ERRORS critical issues. Please fix before building."
    exit 1
fi
