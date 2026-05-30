# Vericonomy Wallet — Alpha Testing Guide

Thank you for helping test **Vericonomy Wallet 1.0.0-alpha**. This is an
early build for hands-on testing. Expect rough edges, and please report
anything that breaks.

> **Alpha disclaimer:** This is pre-release software. Bugs, crashes, and
> incomplete features are expected. Do not store mainnet funds you are not
> prepared to lose. Always keep an independent backup of your wallet and
> recovery phrase before testing.

## Downloads

Grab the installer that matches your machine from the
[GitHub Releases](https://github.com/JoshiOS-VRY/verium/releases) page (look
for the `desktop-v1.0.0-alpha.1` prerelease).

| Platform | Asset | Notes |
| --- | --- | --- |
| Windows 10/11 (x64) | `Vericonomy_Wallet_<version>_Windows_x64.exe` | Unsigned — see SmartScreen note below |
| macOS (Intel) | `Vericonomy_Wallet_<version>_macOS_Intel.dmg` | For Intel Macs |
| macOS (Apple Silicon) | `Vericonomy_Wallet_<version>_macOS_AppleSilicon.dmg` | For M1/M2/M3/M4 Macs |
| Linux x64 | `Vericonomy_Wallet_<version>_Linux_x64.AppImage` or `.deb` | Most desktops/servers |
| Linux ARM64 | `Vericonomy_Wallet_<version>_Linux_ARM64.AppImage` or `.deb` | Raspberry Pi 4/5, ARM servers |

**macOS: pick the DMG that matches your Mac.** If you are unsure, open the
Apple menu → About This Mac. "Apple M…" means Apple Silicon (`aarch64`);
"Intel" means the Intel DMG.

## Installing unsigned builds

Alpha builds are not yet code-signed, so the OS will warn you on first launch.

- **Windows:** SmartScreen may show "Windows protected your PC". Click
  **More info** → **Run anyway**.
- **macOS:** Gatekeeper may say the app is from an unidentified developer.
  Right-click the app → **Open**, then confirm. If macOS refuses, run
  `xattr -dr com.apple.quarantine "/Applications/Vericonomy Wallet.app"`.
- **Linux AppImage:** mark it executable (`chmod +x *.AppImage`) before running.

## What to expect

- The app bundles and manages its own `veriumd` (VRM) and `vericoind` (VRC)
  daemons. No separate Verium/Vericoin install is required.
- Explorer links open the **staging** explorer
  (`staging-explorer.vericonomy.com`). This is intentional for alpha.
- **Auto-update is not wired up.** To upgrade, download the next build from
  the Releases page and reinstall. Your data directory is left untouched.
- Hardware wallet support is **manual xpub / PSBT** only in this build.

## Your data is safe across installs

Installing or upgrading the alpha does not delete your existing data.

| Platform | Data directory |
| --- | --- |
| Windows | `%APPDATA%\Verium` (app prefs under `%APPDATA%\Verium\desktop-app\`) |
| macOS | `~/Library/Application Support/Verium` |
| Linux | `~/.verium` (app prefs under `~/.config/Verium/desktop-app/`) |

## Quick smoke test

1. Install and launch — the Setup wizard should appear.
2. Wait for the node to connect (usually under two minutes on first run).
3. Create or open an encrypted wallet.
4. Generate a receive address and copy it.
5. Switch between Verium (VRM) and Vericoin (VRC) with the coin switcher.
6. Quit and relaunch — your wallet and settings should persist.

See [`TESTING.md`](TESTING.md) for the full QA checklist.

## Reporting issues

Please file bugs on
[GitHub Issues](https://github.com/JoshiOS-VRY/verium/issues) and include:

- Your OS and architecture (e.g. "macOS 14, Apple Silicon").
- The installer asset you used.
- Steps to reproduce, plus the diagnostic bundle from the app's error screen
  ("Copy diagnostic bundle") when applicable.
