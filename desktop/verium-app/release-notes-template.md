# Vericonomy Wallet vX.Y.Z

Replace this template with release notes for the upcoming version. Keep the
top-level heading consistent so the CI release job can extract notes from
CHANGELOG.md by version.

## Highlights

- ...

## Downloads

- Windows installer: `Verium_X.Y.Z_x64-setup.exe`
- macOS (Intel): `Verium_X.Y.Z_x64.dmg`
- macOS (Apple Silicon): `Verium_X.Y.Z_aarch64.dmg`
- Linux AppImage: `Verium_X.Y.Z_amd64.AppImage`
- Linux .deb: `verium_X.Y.Z_amd64.deb`

## Upgrading

1. Close the running wallet.
2. Install the new build (your data directory is left untouched).
3. Re-open the wallet — `veriumd` restarts automatically.

## Notes

- Unsigned binaries on Windows trigger SmartScreen; choose "More info" →
  "Run anyway" on first launch. We plan to ship code-signed builds in 1.1.
- Auto-update is not yet wired; redownload from this release to upgrade.
