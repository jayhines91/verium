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
| App preferences | `<config-dir>/Verium/desktop-app/prefs.json` | No |
| Address book | `<config-dir>/Verium/desktop-app/addressbook.json` | No |
| RPC console history | Browser `localStorage` inside the WebView | No |

Default `<data-dir>`:

- Windows: `%APPDATA%\Verium`
- macOS: `~/Library/Application Support/Verium`
- Linux: `~/.verium`

## What the wallet does NOT store

- Your passphrase. It is held in memory only while the wallet is unlocked
  and never persisted by the desktop app. `walletpassphrase` is invoked
  with the user-provided string and immediately discarded by the React form.
- Telemetry or analytics. No outbound network calls are made except:
  - `veriumd` peer connections (P2P, you control this via the node).
  - JSON-RPC calls to `127.0.0.1` (the bundled daemon).
  - Optional calls to `https://explorer-vrm.vericonomy.com/` and
    `https://files.vericonomy.com/` for price, blocks, bootstrap snapshot,
    and the version-feed update check.

## Passphrase handling

- Required for any signing operation (`sendtoaddress`, `signmessage`,
  `dumpprivkey`).
- `encryptwallet` is intentionally a one-time setup step. After encryption,
  `veriumd` traditionally exits and the app restarts it automatically.
- Passphrase change uses `walletpassphrasechange`. The old passphrase is
  required.
- The unlock duration preset only controls the RPC `walletpassphrase`
  timeout that `veriumd` honors. Closing the wallet does not lock the
  daemon — re-opening it shows the unlock form again only if the timer is
  still active.

## RPC exposure

- RPC binds to `127.0.0.1` only by default. The auto-generated
  `verium.conf` does not include `rpcallowip` for any non-loopback address.
- Credentials are 128-bit random UUIDs (no leading "verium" username on
  generated installs); you can rotate them from **Settings → Advanced →
  Daemon connection → Create RPC login**.

## Sidecar binary

- The bundled `veriumd` is the same binary you would download from
  [files.vericonomy.com/vrm/releases](https://files.vericonomy.com/vrm/releases/).
- It is fetched at build time by `scripts/fetch-veriumd.cjs` and signed by
  the wider Tauri bundling process (no separate signature is applied today).
- v1 releases are **unsigned**. Verify provenance by downloading only from
  the GitHub Releases page of this repository.

## Reporting vulnerabilities

If you believe you have found a security issue:

1. Do **not** open a public GitHub issue.
2. Email **security@vericonomy.com** with a description, reproduction
   steps, and your PGP key if you have one.
3. We aim to respond within 72 hours and to ship a fix in the next patch
   release.

We will credit reporters in the relevant CHANGELOG entry unless you ask
to remain anonymous.

## Known limitations (v1)

- Installers are not code-signed; expect Windows SmartScreen / macOS
  Gatekeeper warnings.
- No auto-update mechanism — you must download new releases manually.
- The RPC console is intentionally power-user only; arbitrary RPC calls
  can move funds and have no extra confirmation step beyond the wallet
  unlock.
- Hardware wallets are not supported.
- Tor / proxy support is whatever you already configure for `veriumd`.
