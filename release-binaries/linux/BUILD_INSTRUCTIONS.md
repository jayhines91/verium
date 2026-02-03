# Linux Build Instructions

This directory contains build scripts for Linux ARM64 and x86_64 binaries.

## Prerequisites

These builds require a Linux environment (Ubuntu/Debian recommended) with cross-compilation toolchains installed.

### For x86_64 Linux builds:
```bash
sudo apt-get update
sudo apt-get install -y \
    build-essential automake libtool pkg-config python3 \
    curl zip unzip ccache \
    g++-multilib libtool binutils-gold bsdmainutils
```

### For ARM64 Linux builds:
```bash
sudo apt-get install -y \
    g++-aarch64-linux-gnu \
    binutils-aarch64-linux-gnu \
    qemu-user-static
```

## Building

### Option 1: Use the build scripts (recommended)

From the project root directory:

**For x86_64:**
```bash
./build-linux-x86.sh
```

**For ARM64:**
```bash
./build-linux-arm.sh
```

### Option 2: Manual build

**For x86_64:**
```bash
export HOST=x86_64-pc-linux-gnu
export CONFIG_SITE=$(pwd)/depends/${HOST}/share/config.site

# Build dependencies
make -C depends HOST=${HOST} -j$(nproc)

# Configure and build
./autogen.sh
./configure --prefix=$(pwd)/depends/${HOST} --host=${HOST} --with-gui=qt5 --enable-reduce-exports --disable-bench --disable-tests
make -j$(nproc)

# Copy binaries
mkdir -p release-binaries/linux/x86
cp src/veriumd src/verium-cli src/verium-tx src/verium-wallet src/qt/verium-qt release-binaries/linux/x86/
```

**For ARM64:**
```bash
export HOST=aarch64-linux-gnu
export CONFIG_SITE=$(pwd)/depends/${HOST}/share/config.site

# Build dependencies
make -C depends HOST=${HOST} -j$(nproc)

# Configure and build
./autogen.sh
./configure --prefix=$(pwd)/depends/${HOST} --host=${HOST} --with-gui=qt5 --enable-reduce-exports --disable-bench --disable-tests
make -j$(nproc)

# Copy binaries
mkdir -p release-binaries/linux/arm
cp src/veriumd src/verium-cli src/verium-tx src/verium-wallet src/qt/verium-qt release-binaries/linux/arm/
```

## Output

Binaries will be placed in:
- `release-binaries/linux/x86/` - x86_64 binaries
- `release-binaries/linux/arm/` - ARM64 binaries

## Notes

- The `depends` system will automatically download and build all required dependencies
- Qt 5.15.18 will be built as part of the dependencies
- Build time can be significant (30-60 minutes depending on hardware)
- Ensure you have at least 8GB RAM and 20GB free disk space
