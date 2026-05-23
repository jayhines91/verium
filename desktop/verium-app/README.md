# Vericonomy Wallet

A modern desktop wallet for [Verium](https://vericonomy.com) (VRM).
Bundles a `veriumd` node, an encrypted wallet, the built-in CPU miner, send &amp;
receive, transaction history, address book, sign/verify, coin control, and an
RPC console — all in a single installer.

> This app replaces the legacy Qt wallet for end users. Contributors who need
> the source-built developer experience can still use `verium-qt` from the
> top-level repository.

## Install

Pre-built installers are published with each release on the
[GitHub Releases page](../../../../releases).

| Platform | Asset |
| --- | --- |
| Windows 10/11 | `Verium_<version>_x64-setup.exe` |
| macOS 10.15+ (Intel) | `Verium_<version>_x64.dmg` |
| macOS 11+ (Apple Silicon) | `Verium_<version>_aarch64.dmg` |
| Linux (Ubuntu/Debian) | `verium_<version>_amd64.deb` |
| Linux (any glibc 2.31+) | `Verium_<version>_amd64.AppImage` |

> **Windows SmartScreen:** v1 releases are unsigned. On first launch you may
> see "Windows protected your PC" — choose **More info → Run anyway**. We
> plan to ship code-signed builds in v1.1.

## What's inside

- **Bundled `veriumd`** — starts automatically on first launch, no separate
  install needed.
- **Encrypted wallet** — a passphrase you choose encrypts `wallet.dat` locally.
  No one can recover it for you; back it up.
- **Send / Receive** with a confirmation dialog, custom fees, coin control,
  and address-book picker.
- **CPU mining** with hashrate chart, profitability estimate (day / week /
  month / year), and a chime when you mine a block.
- **Sign &amp; verify** messages, **RPC console**, debug.log tail.
- **Chain bootstrap** for fast first-time sync from the official snapshot.

## Data locations

The wallet uses platform-standard paths so it cooperates with the legacy
client.

| OS | Data directory | App preferences |
| --- | --- | --- |
| Windows | `%APPDATA%\Verium` | `%APPDATA%\Verium\desktop-app\prefs.json` |
| macOS | `~/Library/Application Support/Verium` | `~/Library/Application Support/Verium/desktop-app/prefs.json` |
| Linux | `~/.verium` | `~/.config/Verium/desktop-app/prefs.json` |

Your encrypted wallet lives at `<data-dir>/wallet.dat`. Block data lives in
`<data-dir>/blocks/` and `<data-dir>/chainstate/`. Auto-generated RPC
credentials are written to `<data-dir>/verium.conf` on first launch.

## Backing up

1. Open **Settings → Wallet backup &amp; passphrase**.
2. Click **Back up wallet.dat**, choose a destination (USB drive, password
   manager attachment, encrypted cloud folder).
3. Verify you remember your passphrase — without it the backup is useless.

To restore on a new machine: install the wallet, close it, drop your backup
into the data directory above as `wallet.dat`, then re-open the wallet.

## Troubleshooting

| Symptom | Try |
| --- | --- |
| "veriumd is not reachable" on first launch | Wait 10–30s for the chain index to load. Open **Settings → Advanced → Daemon connection → Test connection**. |
| Sync is very slow | **Settings → Updates** → check version, or use the **chain bootstrap** option from Setup or the dashboard banner. |
| Wallet locked again unexpectedly | The unlock timer expired; re-enter the passphrase. Adjust the duration on the Wallet page. |
| Can't find your wallet.dat | See the data-locations table above. |
| Anything else | **Settings → Advanced → Logs** copies the last 200 log lines. Open an issue and paste the diagnostic bundle from the error screen. |

## Development

Contributors who want to hack on the wallet:

```sh
cd desktop/verium-app
npm install
# Download the bundled veriumd sidecar for your host platform
npm run fetch:veriumd
# OR write a non-functional placeholder so cargo check / tauri build can validate
# the manifest when you're working offline:
npm run fetch:veriumd:stub
npm run tauri:dev
```

If you maintain a local `veriumd` build (for example a debug build), point
the fetch script at it instead of downloading:

```sh
VERIUMD_LOCAL=/path/to/veriumd npm run fetch:veriumd
```

See [TESTING.md](TESTING.md) for the v1 QA checklist and
[../../doc/desktop-modernization-plan.md](../../doc/desktop-modernization-plan.md)
for the architecture overview. Security-sensitive details are documented in
[../../docs/SECURITY.md](../../docs/SECURITY.md).

## License

Same as the rest of the Verium repository — MIT.
