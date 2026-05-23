# Changelog

All notable changes to the Vericonomy Wallet desktop app are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-22

### Added

- First-class, single-installer experience: bundled `veriumd` shipped as a
  Tauri sidecar. No separate Verium core install required on Windows, macOS,
  or Linux.
- True first-run flow: auto-detect data directory, auto-generate RPC
  credentials, create an encrypted wallet with a passphrase strength meter,
  optional chain bootstrap.
- Send confirmation modal mirroring the legacy Qt wallet (Bitcoin units, 3s
  delay).
- Address book (saved sending and receiving entries, picker dialog in the
  Send panel).
- Coin control modal with explicit UTXO selection, using
  `createrawtransaction` / `fundrawtransaction` / `signrawtransactionwithwallet`
  / `sendrawtransaction`.
- Custom transaction fee editor (`settxfee`), persisted across sessions.
- Wallet backup card: `wallet.dat` export via the native save dialog and
  passphrase change.
- Sign &amp; verify message page (`signmessage` / `verifymessage`).
- Raw RPC console with command history.
- Incoming-VRM toast notifications with sound; debounced burst grouping.
- Block-found celebration (chime + banner) on the dashboard.
- Day / week / month / year toggle for mining revenue cards.
- Top-level error boundary with "Copy diagnostic bundle".
- Cross-platform CI matrix: Windows (NSIS), macOS Intel + Apple Silicon
  (DMG), Linux (AppImage + .deb). Tags matching `desktop-v*` publish a draft
  GitHub Release with the bundle artifacts.

### Changed

- Default data directory is now `dirs::data_dir()/Verium` with no prompt.
  Custom paths live behind the new "Advanced" Settings section.
- Sidebar branding replaces the mocked coin switcher; version pulled from
  `package.json`.

### Removed

- "v0.1.0 prototype" footer label.
- Bundle-disabled CI configuration (`tauri build --no-bundle`).
