# Verium Linux Binaries

This directory contains build scripts and instructions for creating Linux binaries for both x86_64 and ARM64 architectures.

## Directory Structure

```
linux/
├── BUILD_INSTRUCTIONS.md  # Detailed build instructions
├── README.md              # This file
├── x86/                   # x86_64 binaries (created after build)
└── arm/                   # ARM64 binaries (created after build)
```

## Quick Start

### Prerequisites

You need a Linux environment (Ubuntu/Debian recommended) with:

**For x86_64:**
- Standard build tools (g++, make, etc.)

**For ARM64:**
- ARM cross-compilation toolchain:
  ```bash
  sudo apt-get install g++-aarch64-linux-gnu binutils-aarch64-linux-gnu
  ```

### Building

From the project root directory:

**x86_64:**
```bash
./build-linux-x86.sh
```

**ARM64:**
```bash
./build-linux-arm.sh
```

## Binaries Included

After building, each architecture folder will contain:

- **veriumd** - Daemon (headless node)
- **verium-cli** - Command-line interface
- **verium-tx** - Transaction tool
- **verium-wallet** - Wallet tool
- **verium-qt** - GUI application (Qt 5.15.18)

## Building from macOS

If you're on macOS and want to build Linux binaries, you have several options:

1. **Use Docker** (recommended):
   ```bash
   docker run -it -v $(pwd):/workspace ubuntu:22.04 bash
   # Then follow the build instructions inside the container
   ```

2. **Use a Linux VM** (VirtualBox, VMware, Parallels)

3. **Use a remote Linux machine** via SSH

4. **Use GitHub Actions** - See `.github/workflows/linux.yml` for an example

## Notes

- Build time: 30-60 minutes depending on hardware
- Disk space: ~20GB required for dependencies
- RAM: At least 8GB recommended
- The `depends` system will automatically download and build Qt 5.15.18 and all other dependencies
- Binaries are statically linked where possible for portability

## Dependencies

The build system uses the `depends` directory to build:
- Qt 5.15.18 (with GUI support)
- OpenSSL 1.1.1w
- Protocol Buffers 3.21.12
- Boost 1.85
- Berkeley DB 4.8.30
- And other required libraries

See `depends/README.md` for more details.
