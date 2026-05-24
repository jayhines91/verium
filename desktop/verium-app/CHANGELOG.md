# Changelog

All notable changes to the Vericonomy Wallet desktop app are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Security modernization**: encrypted storage (AES-256-GCM + OS keychain), BIP39 recovery phrase, TOTP 2FA, app unlock PIN, auto-lock, QR codes (BIP21) with `verium://` / `vericoin://` deep links, hardware wallet xpub + PSBT flow, multisig, spending controls, audit log, scheduled backups, Shamir social recovery, installer verification, and a dedicated **Security** page.

## [2.0.0] - 2026-05-24

### Added

- **Dual-chain Vericonomy Wallet**: manage Verium (VRM) and Vericoin (VRC) from a single app.
- Bundled `vericoind` sidecar alongside existing `veriumd` (independent daemons, separate datadirs).
- Sidebar **coin switcher** — toggle active chain for single-coin pages (Wallet, Transactions, Network, etc.).
- **Blended dashboard** showing both chains: balances, sync status, mining + staking Stats, merged activity feed.
- **Staking page** for Vericoin (`stakingstart` / `stakingstop`, stake balance, estimated reward time).
- **Concurrent earn**: CPU mining on VRM and PoST staking on VRC can run simultaneously.
- Per-chain enable/disable toggles in Settings → Chains (opt-out to save resources).
- Staking-only wallet unlock mode for Vericoin (`walletpassphrase` minting-only).
- Stake reward celebration toasts and incoming VRC notifications.
- Per-coin address books, daemon configs, and OS keychain entries.
- `fetch-vericoind.cjs` script and CI support for dual sidecar bundling.

### Changed

- App rebranded to **Vericonomy Wallet** (`com.vericonomy.wallet.desktop`).
- All RPC/Tauri commands now take a `coin` argument (`verium` | `vericoin`).
- React Query cache keys are coin-scoped.
- Preferences moved to `%APPDATA%/Vericonomy/desktop-app/prefs.json`.
- Daemon configs stored as `daemon-verium.json` / `daemon-vericoin.json`.

### Migration

- Existing 1.0.0 users: `daemon.json` → `daemon-verium.json` (automatic on first launch).
- `addressbook.json` → `addressbook-verium.json` (automatic).
- Keychain service id changed; auto-unlock may require re-entering passphrase once.
- Legacy Vericoin Qt users: point setup at existing `%APPDATA%/Vericonomy` datadir.

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
- Sign & verify message page (`signmessage` / `verifymessage`).
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
