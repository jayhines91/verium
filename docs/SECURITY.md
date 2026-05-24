# Vericonomy Wallet — Security Model

This document covers the security-relevant promises and trade-offs of the
desktop wallet shipped under `desktop/verium-app/`. The legacy Qt wallet is
covered separately by the core repository.

## What the wallet stores

| Data | Location | Encrypted? |
| --- | --- | --- |
| Private keys (`wallet.dat`) | `<data-dir>/wallet.dat` | Yes — AES-256 with your passphrase, performed by `veriumd` |
| Chain state, blocks | `<data-dir>/blocks/`, `<data-dir>/chainstate/` | No (public chain data) |
| RPC credentials | `<data-dir>/verium.conf` | No — auto-generated, randomized per install |
| App preferences | Encrypted blob in `<config-dir>/Verium/desktop-app/secure/` | Yes — AES-256-GCM, key in OS keychain |
| Address book | Encrypted blob in `secure/` | Yes |
| Receive request history | Encrypted blob in `secure/` | Yes |
| 2FA secrets, audit log, backup hashes | Encrypted blob in `secure/` | Yes |
| RPC console history | Browser `localStorage` inside the WebView | No |

Default `<data-dir>`:

- Windows: `%APPDATA%\Verium`
- macOS: `~/Library/Application Support/Verium`
- Linux: `~/.verium`

## Recovery (BIP39)

- New wallets can generate a 24-word BIP39 recovery phrase during setup.
- The phrase is verified word-by-word before HD seed is applied via `sethdseed`.
- **Limitation:** The mnemonic only covers keys derived after HD upgrade. Pre-existing imported private keys are not covered unless re-imported.
- Optional Shamir 2-of-3 social recovery splits the mnemonic into shares (`VRMSHARE-*` format).

## Two-factor authentication (TOTP)

- TOTP (RFC 6238) gates sensitive actions: send above threshold, change passphrase, show recovery phrase, `dumpprivkey`, restore wallet, edit `verium.conf`.
- 10 single-use recovery codes are generated at enrollment (hashed at rest).
- Disabling 2FA triggers a 24-hour cooling-off period.

## App unlock PIN

- Optional 6+ digit PIN gates the UI before the wallet shell renders.
- PIN hash stored encrypted; verified via Argon2id.

## Auto-lock

- Configurable idle timeout, lock-on-blur, and lock-on-sleep.
- Triggers `walletlock` RPC when conditions are met.

## Hardware wallets

- Watch-only xpub import via `importpubkey`.
- Sends use PSBT flow: `walletcreatefundedpsbt` → device sign → `finalizepsbt` → `sendrawtransaction`.
- Trezor/Ledger USB detection is best-effort; manual xpub import is always available.
- Coldcard air-gapped signing via PSBT file/QR.

## Multisig

- 2-of-N multisig via `addmultisigaddress` + PSBT cosigner routing.
- Cosigner labels stored in encrypted address book.

## Spending controls

- Clipboard hijack detection re-checks pasted addresses at send time.
- Daily spend caps, first-send-to-new-address confirmation, address allowlist mode.
- Look-alike address warnings for similar prefixes/suffixes.

## Backups

- Scheduled local backups with SHA-256 hash verification.
- Encrypted cloud backup (`.vbackup`) with a separate backup password (Argon2id + AES-GCM).
- Backup health card on Dashboard nags when backups are stale.

## Audit log

- Append-only Ed25519-signed log of sensitive operations.
- Exportable as signed JSON from Settings → Security.

## Installer verification

- Release builds can embed `release-hashes.json` for app + sidecar SHA-256 verification.
- CI can sign artifacts with Sigstore cosign (see `.github/workflows/desktop-app.yml`).

## Passphrase handling

- Required for any signing operation (`sendtoaddress`, `signmessage`, `dumpprivkey`).
- "Forever" unlock stores passphrase in OS keychain (Windows Credential Manager, macOS Keychain, Linux Secret Service).
- Passphrase never written to disk by the desktop app.

## RPC exposure

- RPC binds to `127.0.0.1` only by default.
- Credentials are 128-bit random UUIDs.

## Reporting vulnerabilities

Email **security@vericonomy.com** — do not open public GitHub issues for security bugs.

## Known limitations

- Installers may not be code-signed on all platforms; verify hashes from official releases.
- UI-layer 2FA/PIN does not stop an attacker with disk access who runs their own `veriumd` — the wallet passphrase is the root of trust on disk.
- Ledger support uses manual xpub import; Verium BIP44 coin type is unregistered.
- Regtest is disabled in chain parameters.
