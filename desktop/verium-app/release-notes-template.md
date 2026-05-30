# Vericonomy Wallet vX.Y.Z

Replace this template with release notes for the upcoming version. Keep the
top-level heading consistent so the CI release job can extract notes from
CHANGELOG.md by version.

## Highlights

- ...

## Downloads

- Windows installer (x64): `Vericonomy_Wallet_X.Y.Z_Windows_x64.exe`
- macOS (Intel): `Vericonomy_Wallet_X.Y.Z_macOS_Intel.dmg`
- macOS (Apple Silicon): `Vericonomy_Wallet_X.Y.Z_macOS_AppleSilicon.dmg`
- Linux AppImage (x64): `Vericonomy_Wallet_X.Y.Z_Linux_x64.AppImage`
- Linux .deb (x64): `Vericonomy_Wallet_X.Y.Z_Linux_x64.deb`
- Linux AppImage (ARM64): `Vericonomy_Wallet_X.Y.Z_Linux_ARM64.AppImage`
- Linux .deb (ARM64): `Vericonomy_Wallet_X.Y.Z_Linux_ARM64.deb`

On macOS, choose the DMG that matches your Mac: Apple Silicon (`aarch64`) for
M-series Macs, Intel (`x64`) otherwise.

## Upgrading

1. Close the running wallet.
2. Install the new build (your data directory is left untouched).
3. Re-open the wallet — `veriumd` restarts automatically.

## Notes

- Unsigned binaries on Windows trigger SmartScreen; choose "More info" →
  "Run anyway" on first launch. We plan to ship code-signed builds in 1.1.
- Auto-update is not yet wired; redownload from this release to upgrade.
