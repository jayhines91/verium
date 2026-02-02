#!/bin/bash
set -e

echo "=== Building Linux ARM64 binaries ==="
echo "Note: This script requires a Linux environment with ARM cross-compilation toolchains"
echo ""

# Check if we're on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "⚠️  Warning: This script is designed for Linux environments."
    echo "   For macOS, you'll need to use Docker or a Linux VM."
    echo "   See release-binaries/linux/BUILD_INSTRUCTIONS.md for details."
    exit 1
fi

# Set up environment
export HOST=aarch64-linux-gnu
export CONFIG_SITE=$(pwd)/depends/${HOST}/share/config.site

# Check for ARM cross-compiler
if ! command -v aarch64-linux-gnu-g++ &> /dev/null; then
    echo "❌ Error: aarch64-linux-gnu-g++ not found."
    echo "   Please install: sudo apt-get install g++-aarch64-linux-gnu binutils-aarch64-linux-gnu"
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
    --enable-glibc-back-compat \
    --disable-bench \
    --disable-tests \
    CXXFLAGS="-Wno-psabi" \
    || { echo "=== config.log (tail) ==="; tail -n 200 config.log || true; exit 1; }

# Build
echo "Building (this may take a while)..."
make -j$(nproc 2>/dev/null || echo 4) V=1

# Copy binaries
echo "Copying binaries..."
mkdir -p release-binaries/linux/arm
cp src/veriumd release-binaries/linux/arm/
cp src/verium-cli release-binaries/linux/arm/
cp src/verium-tx release-binaries/linux/arm/
cp src/verium-wallet release-binaries/linux/arm/
cp src/qt/verium-qt release-binaries/linux/arm/

# Make binaries executable
chmod +x release-binaries/linux/arm/*

echo ""
echo "✅ Linux ARM64 binaries built successfully!"
echo "   Location: release-binaries/linux/arm/"
ls -lh release-binaries/linux/arm/
