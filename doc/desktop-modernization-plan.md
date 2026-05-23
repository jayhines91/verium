# Verium Desktop UI Modernization Plan

> Status: Phased migration in progress. The legacy `verium-qt` GUI remains the
> reference desktop client. A new Tauri + Vite + React + Tailwind application is
> being built in parallel under `desktop/verium-app/` and will not be the
> default ship target until feature parity is reached and maintainers approve
> deprecation of the Qt UI.

## 1. Executive Summary

Verium today ships as a Bitcoin Core–lineage monolith. The Qt GUI in
[`src/qt/`](../src/qt/) embeds the full node, wallet, and built-in CPU miner in
a single process via [`interfaces::Node`](../src/interfaces/node.h) and
[`interfaces::Wallet`](../src/interfaces/wallet.h). The GUI does not normally
talk to the node over HTTP JSON-RPC; only the debug console calls
[`m_node.executeRpc()`](../src/qt/rpcconsole.cpp).

This plan modernizes the desktop UI without rewriting consensus, networking,
wallet cryptography, or the mining algorithm. The strategy is to:

1. Keep [`veriumd`](../src/bitcoind.cpp), [`src/wallet/`](../src/wallet/),
   [`src/miner.cpp`](../src/miner.cpp), and all consensus and networking code
   unchanged.
2. Run `veriumd` as a managed subprocess (or attach to an already-running
   instance) with `server=1` enabled, so JSON-RPC is the single transport for
   the new UI.
3. Build a new desktop shell under `desktop/verium-app/` using Tauri 2 with a
   Vite + React + TypeScript + Tailwind frontend.
4. Bridge the UI to the backend through:
   - HTTP JSON-RPC on `127.0.0.1:33987` (mainnet) or `33988` (testnet) per
     [`chainparamsbase.cpp`](../src/chainparamsbase.cpp).
   - [`verium-cli`](../src/bitcoin-cli.cpp) as a fallback CLI adapter.
   - Direct filesystem reads for `debug.log` and `verium.conf`.
   - Tauri-side process management for daemon lifecycle.
5. Keep [`verium-qt`](../src/qt/) functional throughout the migration so that
   contributors and end users always have a working desktop client.

## 2. Current Architecture Findings

### Repository layout

| Area | Path | Notes |
| --- | --- | --- |
| Core node and consensus | [`src/validation.cpp`](../src/validation.cpp), [`src/consensus/`](../src/consensus/), [`src/net_processing.cpp`](../src/net_processing.cpp) | Do not modify for UI migration. |
| Wallet | [`src/wallet/`](../src/wallet/) | BDB-backed `CWallet`, encryption, RPC in [`rpcwallet.cpp`](../src/wallet/rpcwallet.cpp). |
| Mining | [`src/miner.cpp`](../src/miner.cpp), [`src/rpc/mining.cpp`](../src/rpc/mining.cpp) | Built-in scrypt² CPU miner; no separate miner binary. |
| RPC and HTTP | [`src/rpc/`](../src/rpc/), [`src/httprpc.cpp`](../src/httprpc.cpp), [`src/httpserver.cpp`](../src/httpserver.cpp) | JSON-RPC plus optional REST (`-rest`). |
| Qt GUI | [`src/qt/`](../src/qt/) | Entry: [`main.cpp`](../src/qt/main.cpp) calls [`GuiMain()`](../src/qt/bitcoin.cpp). |
| Bootstrap and updates | [`src/downloader.cpp`](../src/downloader.cpp) | libcurl downloads from `files.vericonomy.com`. |
| Build | [`autogen.sh`](../autogen.sh), [`configure.ac`](../configure.ac), [`src/Makefile.am`](../src/Makefile.am) | Autotools, MSVC, and `depends/`. |
| CI packaging | [`.github/workflows/`](../.github/workflows/) | Linux/macOS/Windows cross-builds; NSIS plus `.dmg`. |

### Daemon

* Entry: [`src/bitcoind.cpp`](../src/bitcoind.cpp) calling
  [`AppInitMain()`](../src/init.cpp).
* `veriumd` defaults `server=1` via `SoftSetBoolArg("-server", true)`, so
  JSON-RPC is enabled out of the box for the headless daemon.
* Shutdown: `stop` RPC triggers [`StartShutdown()`](../src/shutdown.cpp), which
  the main loop polls every 200 ms.

### Qt wallet

* Binary: `src/qt/verium-qt` (configured as `BITCOIN_GUI_NAME=verium-qt`).
* Embeds the node in-process via `interfaces::MakeNode()` in
  [`bitcoin.cpp`](../src/qt/bitcoin.cpp). The core runs on a `BitcoinCore`
  worker thread; the UI runs on the main Qt thread.
* Models bridge core to views:
  [`ClientModel`](../src/qt/clientmodel.cpp) (sync, peers, network),
  [`WalletModel`](../src/qt/walletmodel.cpp) (balances, send, encrypt/unlock),
  and [`WalletController`](../src/qt/walletcontroller.cpp) (multi-wallet).
* Mining starts in the GUI via
  [`OverviewPage::manageMiningState()`](../src/qt/overviewpage.cpp) calling
  `GenerateVerium()` directly, bypassing RPC.

### Mining

* Integrated into the node; rewards go to the wallet via `ReserveDestination`
  in [`miner.cpp`](../src/miner.cpp).
* RPC: `minerstart`, `minerstop`, `getmininginfo`, `getblocktemplate`,
  `submitblock`.
* Gated during IBD and when peers are missing.

### RPC and CLI

| Tool | Source | Role |
| --- | --- | --- |
| `verium-cli` | [`bitcoin-cli.cpp`](../src/bitcoin-cli.cpp) | JSON-RPC client; cookie or user/pass auth. |
| `verium-tx` | [`bitcoin-tx.cpp`](../src/bitcoin-tx.cpp) | Offline transaction construction. |
| `verium-wallet` | [`bitcoin-wallet.cpp`](../src/bitcoin-wallet.cpp) | Offline `info` and `create`. |

Default RPC ports come from
[`chainparamsbase.cpp`](../src/chainparamsbase.cpp): mainnet 33987, testnet
33988. P2P defaults are mainnet 36988 and testnet 36989.

Config file is `verium.conf` in the platform data directory per
[`doc/verium-conf.md`](verium-conf.md):

* Windows: `%APPDATA%\Verium\`
* Linux: `~/.verium/`
* macOS: `~/Library/Application Support/Verium/`

Authentication uses the `.cookie` file in the data directory when no
`rpcpassword` is configured (see
[`share/examples/verium.conf`](../share/examples/verium.conf)).

Regtest is currently disabled in chain parameters; the daemon throws
"Unknown chain" if `-regtest` is supplied. Reenabling regtest is out of
scope for the desktop migration.

### Build assumptions

* Autotools is primary; the wallet requires Berkeley DB 4.8 via
  [`contrib/install_db4.sh`](../contrib/install_db4.sh).
* Qt 5 (or Qt 4) is required for `verium-qt`.
* Bootstrap and update features need libcurl per
  [`doc/build-unix.md`](build-unix.md).
* Release packaging uses NSIS ([`share/setup.nsi`](../share/setup.nsi)) and
  macOS `.dmg` ([`contrib/macdeploy/`](../contrib/macdeploy/)).

### Critical gap for migration

`verium-qt` does not default `server=1`. The Qt wallet uses in-process
interfaces, not network RPC. The new Tauri app must therefore use `veriumd`
as its backend process, not `verium-qt`.

## 3. Target Architecture

```
veriumd  /  wallet core  /  built-in miner
                    |
                    v
    local JSON-RPC  /  verium-cli  /  filesystem adapter
                    |
                    v
              Tauri backend commands
                    |
                    v
         Vite + React + Tailwind frontend
```

Proposed (non-invasive) repo layout:

```
verium/
├── src/                    # existing C++ core (unchanged)
├── doc/
│   └── desktop-modernization-plan.md
├── contrib/
│   └── rpc-capability-matrix.md
└── desktop/
    └── verium-app/
        ├── package.json
        ├── vite.config.ts
        ├── tailwind.config.ts
        ├── tsconfig.json
        ├── src/
        │   ├── pages/
        │   ├── components/
        │   ├── hooks/
        │   └── lib/rpc/
        └── src-tauri/
            ├── tauri.conf.json
            ├── Cargo.toml
            └── src/
                ├── main.rs
                ├── daemon.rs    # process lifecycle
                ├── rpc.rs       # JSON-RPC client
                ├── config.rs    # verium.conf reader/writer
                └── logs.rs      # debug.log tail
```

## 4. Migration Strategy

* Phase 0: Repository audit and safety boundaries. Document architecture and
  RPC matrix. Agree on `veriumd` subprocess plus RPC as the backend model.
* Phase 1: Keep the existing Qt wallet working. Continue Qt theme work on a
  separate track and ensure `veriumd` plus `verium-cli` are healthy.
* Phase 2: Build a standalone Tauri prototype with Tailwind and shadcn-style
  components, no daemon connection yet.
* Phase 3: Connect to a local daemon over JSON-RPC with cookie auth.
* Phase 4: Add wallet status and sync status views.
* Phase 5: Add a mining dashboard with `minerstart` / `minerstop` and a
  hashrate chart.
* Phase 6: Add the bootstrap and update flows. **(Done.)** See
  [`desktop/verium-app/src-tauri/src/bootstrap.rs`](../desktop/verium-app/src-tauri/src/bootstrap.rs),
  the bootstrap banner and dialog on the Dashboard, and the manifest-aware
  update check in
  [`desktop/verium-app/src-tauri/src/updates.rs`](../desktop/verium-app/src-tauri/src/updates.rs).
* Phase 7: Add transactions, history, and address views, plus a guarded send
  flow.
* Phase 8: Cross-platform packaging and a CI job that produces installers.
* Phase 9: Optional deprecation of the legacy Qt UI after feature parity and
  maintainer approval.

## 5. Safety Boundaries

The following are off-limits during UI migration:

| Domain | Paths |
| --- | --- |
| Consensus and validation | [`src/consensus/`](../src/consensus/), [`src/validation.cpp`](../src/validation.cpp), [`src/pow.cpp`](../src/pow.cpp) |
| Networking | [`src/net.cpp`](../src/net.cpp), [`src/net_processing.cpp`](../src/net_processing.cpp), [`src/addrman.cpp`](../src/addrman.cpp) |
| Wallet cryptography | [`src/wallet/crypter.cpp`](../src/wallet/crypter.cpp), key derivation and signing in [`src/wallet/wallet.cpp`](../src/wallet/wallet.cpp) |
| Key management | [`src/key.cpp`](../src/key.cpp), [`src/pubkey.cpp`](../src/pubkey.cpp), HD seed logic |
| Chain parameters | [`src/chainparams.cpp`](../src/chainparams.cpp), [`src/chainparamsbase.cpp`](../src/chainparamsbase.cpp) |
| Mining algorithm | [`src/crypto/scrypt.cpp`](../src/crypto/scrypt.cpp), the PoW loop in [`src/miner.cpp`](../src/miner.cpp) |
| Transaction signing | [`src/script/`](../src/script/), `signrawtransaction*` internals |
| Script interpreter | [`src/script/interpreter.cpp`](../src/script/interpreter.cpp) |

Safe additions are limited to documentation under `doc/`, the new
`desktop/` directory, and CI workflow additions that do not modify existing
build steps.

## 6. Required Backend Interface

The full mapping of UI features to RPC, CLI, or filesystem adapters lives in
[`contrib/rpc-capability-matrix.md`](../contrib/rpc-capability-matrix.md).
Highlights:

* Sync and node status are fully covered by `getblockchaininfo`,
  `getnetworkinfo`, `getconnectioncount`, and `uptime`.
* Wallet balance, addresses, and history are covered by `getbalance`,
  `getwalletinfo`, `getnewaddress`, and `listtransactions`.
* Mining is covered by `getmininginfo`, `minerstart`, and `minerstop`. Mining
  state is tracked locally in the Tauri layer because the daemon reports
  hashrate, not a boolean "active" flag.
* Logs and config require Tauri-side adapters (no log-tail or
  read/write-config RPC exists).
* Daemon lifecycle (`startDaemon`, `restartDaemon`) is implemented by the
  Tauri process manager; `stop` is covered by RPC.
* Update checks reuse the `VERSION_VRM.json` URL referenced in
  [`src/downloader.h`](../src/downloader.h).

## 7. Tauri App Design

Tauri owns:

* Daemon process lifecycle (spawn, stop, restart, health check).
* RPC transport with cookie or `rpcuser`/`rpcpassword` auth.
* Secure handling of wallet passphrases: collected in the Tauri command
  layer, passed to `walletpassphrase`, and never persisted.
* Filesystem reads scoped to the user-selected data directory.
* Log tailing with rotation awareness.
* Cross-platform packaging (NSIS/WiX, `.dmg` + notarization, AppImage/deb).

The Tauri frontend is sandboxed by a strict CSP and never makes outbound
network requests directly; all RPC and update calls go through Rust commands.

## 8. Frontend Design

Pages and primary data sources:

| Page | RPC / source |
| --- | --- |
| Dashboard | `getblockchaininfo`, `getwalletinfo`, `getmininginfo` |
| Wallet | `getbalance`, `getnewaddress`, `encryptwallet`, `walletpassphrase` |
| Mining | `getmininginfo`, `minerstart`, `minerstop` |
| Network | `getpeerinfo`, `getnetworkinfo` |
| Transactions | `listtransactions`, `gettransaction`, `sendtoaddress` |
| Logs | Tauri tail of `debug.log` |
| Settings | `verium.conf` adapter, datadir picker, theme toggle |
| Setup wizard | First-run flow plus `bootstrap` RPC |

Libraries: Tailwind CSS, shadcn/ui or Radix UI primitives, Recharts for time
series, TanStack Query for polling, Zustand for local UI state, and
`react-router-dom` for routing.

## 9. Development Milestones

See the plan file in `.cursor/plans/` and the milestone table in §9 of the
plan checked into agent transcripts. Each milestone targets an independently
reviewable PR scoped to the `desktop/`, `doc/`, or `contrib/` directories.

## 10. Risk Assessment

* RPC gaps for logs, config, and mining state are mitigated with filesystem
  adapters and locally tracked state.
* Wallet encryption and unlock are kept off the frontend; the passphrase
  never leaves the Tauri Rust process.
* Cross-platform packaging, code signing, and notarization are deferred to
  Phase 8 and reuse the same channels as the existing Qt releases.
* Accidental consensus changes are prevented by limiting PRs to
  `desktop/`, `doc/`, and `contrib/` and by the safety boundary list above.

## 11. Recommended First PRs

1. Add `doc/desktop-modernization-plan.md` and
   `contrib/rpc-capability-matrix.md` (this PR).
2. Add the Tauri prototype under `desktop/verium-app/` with static UI only.
3. Add the Rust JSON-RPC client and a "daemon detection" status indicator.
4. Add a read-only node status panel populated from `getblockchaininfo` and
   `getnetworkinfo`.
5. Add the mining dashboard with `minerstart` / `minerstop` and a hashrate
   chart.

## 12. Open Questions for Maintainers

1. Should the Tauri app bundle `veriumd` and `verium-cli`, or require an
   externally installed core?
2. Is the legacy Qt wallet expected to remain supported indefinitely?
3. Which OS should Phase 8 target first?
4. Should mining stay in the wallet UI or split into a separate tool?
5. Is wallet encrypt/unlock/send required in v1 of the new app, or is
   read-only acceptable?
6. What is the preferred signing and notarization workflow?
7. Is `-testnet` support required at launch? (Regtest is currently disabled
   in chain parameters.)
