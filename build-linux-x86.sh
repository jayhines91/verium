#!/bin/bash
set -e

echo "=== Building Linux x86_64 binaries ==="
echo "Note: This script requires a Linux environment with cross-compilation toolchains"
echo ""

# Check if we're on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "⚠️  Warning: This script is designed for Linux environments."
    echo "   For macOS, you'll need to use Docker or a Linux VM."
    echo "   See release-binaries/linux/BUILD_INSTRUCTIONS.md for details."
    exit 1
fi

# Set up environment
export HOST=x86_64-pc-linux-gnu
export CONFIG_SITE=$(pwd)/depends/${HOST}/share/config.site

# Check for required tools
if ! command -v g++ &> /dev/null; then
    echo "❌ Error: g++ not found. Please install build-essential."
    exit 1
fi

# Build dependencies if not already built
if [ ! -d "depends/${HOST}" ]; then
    echo "Building dependencies for ${HOST}..."
    make -C depends HOST=${HOST} -j$(nproc 2>/dev/null || echo 4)
else
    echo "Dependencies already built for ${HOST}"
fi

# Clean previous build
echo "Cleaning previous build..."
make clean || true

# Configure
echo "Configuring build..."
./autogen.sh
./configure \
    --prefix=$(pwd)/depends/${HOST} \
    --host=${HOST} \
    --with-gui=qt5 \
    --enable-reduce-exports \
    --disable-bench \
    --disable-tests \
    || { echo "=== config.log (tail) ==="; tail -n 200 config.log || true; exit 1; }

# Build
echo "Building (this may take a while)..."
make -j$(nproc 2>/dev/null || echo 4) V=1

# Copy binaries
echo "Copying binaries..."
mkdir -p release-binaries/linux/x86
cp src/veriumd release-binaries/linux/x86/
cp src/verium-cli release-binaries/linux/x86/
cp src/verium-tx release-binaries/linux/x86/
cp src/verium-wallet release-binaries/linux/x86/
cp src/qt/verium-qt release-binaries/linux/x86/

# Make binaries executable
chmod +x release-binaries/linux/x86/*

echo ""
echo "✅ Linux x86_64 binaries built successfully!"
echo "   Location: release-binaries/linux/x86/"
ls -lh release-binaries/linux/x86/
