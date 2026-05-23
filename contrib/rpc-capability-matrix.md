# Verium RPC Capability Matrix

This document maps each feature of the new Tauri desktop UI to a backend
mechanism (JSON-RPC call, CLI subprocess, or filesystem adapter) and notes
gaps that require Tauri-side implementation.

All RPC calls assume `veriumd` is running with `server=1`. Default endpoints:

* Mainnet: `http://127.0.0.1:33987/`
* Testnet: `http://127.0.0.1:33988/`
* Multi-wallet: append `/wallet/<name>` to the URL or pass `-rpcwallet=<name>`
  to `verium-cli`.

Authentication is via the `.cookie` file in the data directory when no
`rpcuser`/`rpcpassword` is configured.

## Legend

* RPC – method exists in the running daemon. Source files:
  [`src/rpc/`](../src/rpc/) and [`src/wallet/rpcwallet.cpp`](../src/wallet/rpcwallet.cpp).
* CLI – wrapped invocation of [`verium-cli`](../src/bitcoin-cli.cpp).
* FS – filesystem read/write performed by the Tauri Rust backend.
* Tauri – process management or local state tracked entirely in the Tauri
  layer.

## UI feature to backend mapping

| UI feature | Mechanism | Method or source | Notes |
| --- | --- | --- | --- |
| `getNodeStatus` | RPC (composite) | `getnetworkinfo` + `getblockchaininfo` + `getwalletinfo` + `uptime` | Aggregated in the Tauri command layer to one struct. |
| `getSyncStatus` | RPC | `getblockchaininfo` | Fields: `blocks`, `headers`, `verificationprogress`, `initialblockdownload`. |
| `getBlockHeight` | RPC | `getblockchaininfo.blocks` | |
| `getPeerCount` | RPC | `getconnectioncount` | Or `getnetworkinfo.connections`. |
| `getWalletBalance` | RPC | `getbalance`, `getwalletinfo` | Pass wallet name via `/wallet/<name>`. |
| `getReceiveAddress` | RPC | `getnewaddress` | Optional label argument. |
| `getRecentTransactions` | RPC | `listtransactions` | Use `listsinceblock` for pagination. |
| `getMiningStatus` | RPC + local state | `getmininginfo` | No boolean active flag; Tauri tracks last `minerstart`/`minerstop` and infers from `hashrate > 0`. |
| `startMining` | RPC | `minerstart` | Requires wallet loaded and unlocked. Arg: `nthreads`. |
| `stopMining` | RPC | `minerstop` | |
| `getHashrate` | RPC | `getmininginfo.hashrate` | Units are H/m (Verium-specific). |
| `getLogs` | FS | Tail of `<datadir>/debug.log` | No RPC for streaming logs; `logging` only toggles categories. |
| `getConfig` | FS | Parse `<datadir>/verium.conf` | Schema documented in [`doc/verium-conf.md`](../doc/verium-conf.md). |
| `updateConfig` | FS | Write `<datadir>/verium.conf` (backup first) | Most changes require daemon restart. |
| `startDaemon` | Tauri | Spawn `veriumd -datadir=...` | Bundle or detect existing binary (see plan §12). |
| `stopDaemon` | RPC | `stop` | Wait for exit with timeout, force kill on timeout. |
| `restartDaemon` | Tauri | `stop` then spawn | |
| `importBootstrap` | RPC | `bootstrap` | Triggers download and clean daemon shutdown ([`src/rpc/blockchain.cpp`](../src/rpc/blockchain.cpp)). Tauri then restarts the daemon. |
| `checkForUpdates` | FS + HTTP | `VERSION_VRM.json` URL from [`src/downloader.h`](../src/downloader.h) | Implemented in Tauri Rust using `reqwest`. |
| `unlockWallet` | RPC | `walletpassphrase` | Tauri collects passphrase and zeroes the buffer after the call. |
| `lockWallet` | RPC | `walletlock` | |
| `encryptWallet` | RPC | `encryptwallet` | Triggers daemon shutdown per Bitcoin Core convention. |
| `sendToAddress` | RPC | `sendtoaddress` | Frontend collects amount and destination; Tauri prompts for unlock first. |
| `validateAddress` | RPC | `validateaddress` | Used in the send form to gate the submit button. |
| `getPeers` | RPC | `getpeerinfo` | For the Network page. |
| `getMempoolSize` | RPC | `getmempoolinfo` | Optional dashboard widget. |
| `openConsole` | RPC | Arbitrary methods | Optional advanced page; pass-through over the same client. |

## RPC method inventory

Source files: [`src/rpc/server.cpp`](../src/rpc/server.cpp),
[`src/rpc/blockchain.cpp`](../src/rpc/blockchain.cpp),
[`src/rpc/net.cpp`](../src/rpc/net.cpp),
[`src/rpc/mining.cpp`](../src/rpc/mining.cpp),
[`src/rpc/misc.cpp`](../src/rpc/misc.cpp),
[`src/rpc/rawtransaction.cpp`](../src/rpc/rawtransaction.cpp),
[`src/wallet/rpcwallet.cpp`](../src/wallet/rpcwallet.cpp).

### Control

`getrpcinfo`, `help`, `stop`, `uptime`, `getmemoryinfo`, `logging`.

### Blockchain

`bootstrap`, `getblockchaininfo`, `getchaintxstats`, `getblockstats`,
`getbestblockhash`, `getblockcount`, `getblock`, `getblockhash`,
`getblockheader`, `getblocktime`, `getchaintips`, `getdifficulty`,
`getmempoolancestors`, `getmempooldescendants`, `getmempoolentry`,
`getmempoolinfo`, `getrawmempool`, `getsubsidy`, `gettxout`,
`gettxoutsetinfo`, `pruneblockchain`, `savemempool`, `verifychain`,
`preciousblock`, `scantxoutset`, `getblockfilter`, `gettxoutproof`,
`verifytxoutproof`.

### Network

`getconnectioncount`, `ping`, `getpeerinfo`, `addnode`, `disconnectnode`,
`getaddednodeinfo`, `getnettotals`, `getnetworkinfo`, `setban`, `listbanned`,
`clearbanned`, `setnetworkactive`, `getnodeaddresses`.

### Raw transactions and PSBT

`getrawtransaction`, `createrawtransaction`, `decoderawtransaction`,
`decodescript`, `sendrawtransaction`, `combinerawtransaction`,
`signrawtransactionwithkey`, `testmempoolaccept`, `decodepsbt`,
`combinepsbt`, `finalizepsbt`, `createpsbt`, `converttopsbt`, `joinpsbts`,
`analyzepsbt`.

### Util

`validateaddress`, `createmultisig`, `deriveaddresses`, `getdescriptorinfo`,
`verifymessage`, `signmessagewithprivkey`.

### Mining and generating

`getmininginfo`, `getblocktemplate`, `submitblock`, `submitheader`,
`generatetoaddress`, `minerstart`, `minerstop`.

### Wallet

`abandontransaction`, `abortrescan`, `addmultisigaddress`, `backupwallet`,
`createwallet`, `dumpprivkey`, `dumpwallet`, `encryptwallet`,
`fundrawtransaction`, `getaddressesbylabel`, `getaddressinfo`, `getbalance`,
`getbalances`, `getnewaddress`, `getrawchangeaddress`, `getreceivedbyaddress`,
`getreceivedbylabel`, `gettransaction`, `getunconfirmedbalance`,
`getwalletinfo`, `importaddress`, `importmulti`, `importprivkey`,
`importprunedfunds`, `importpubkey`, `importwallet`, `keypoolrefill`,
`listaddressgroupings`, `listlabels`, `listlockunspent`,
`listreceivedbyaddress`, `listreceivedbylabel`, `listsinceblock`,
`listtransactions`, `listunspent`, `listwalletdir`, `listwallets`,
`loadwallet`, `lockunspent`, `removeprunedfunds`, `rescanblockchain`,
`sendmany`, `sendtoaddress`, `sethdseed`, `setlabel`, `settxfee`,
`setwalletflag`, `signmessage`, `signrawtransactionwithwallet`,
`unloadwallet`, `walletcreatefundedpsbt`, `walletlock`, `walletpassphrase`,
`walletpassphrasechange`, `walletprocesspsbt`.

## External Vericonomy integrations

These features in the new desktop app live entirely outside the daemon RPC
surface. They are powered by official Vericonomy public endpoints and are
implemented in the Tauri Rust backend so the frontend never makes direct
external HTTP calls.

| Tauri command | Purpose | External endpoint |
| --- | --- | --- |
| `open_external_url` | Open `https://` URLs in the system browser. | n/a |
| `detect_veriumd` | Locate the `veriumd` binary on disk. | n/a |
| `get_user_preferences` / `set_user_preferences` | Persist desktop-only prefs (explorer URL templates, bootstrap snooze, setup flag). | `<config_dir>/Verium/desktop-app/prefs.json` |
| `import_bootstrap` | Trigger the daemon's `bootstrap` RPC with a 1-hour timeout, then restart `veriumd`. | `https://files.vericonomy.com/vrm/bootstrap/verium-bootstrap.zip` (via the daemon) |
| `check_for_updates` | Compare local app version against CDN feed and bundled manifest. | `https://files.vericonomy.com/vrm/VERSION_VRM.json` plus [`releases-manifest.json`](../desktop/verium-app/src/lib/releases-manifest.json) |
| `fetch_explorer_stats` | Aggregated network/market stats (mining info, supply, price). | `https://explorer-vrm.vericonomy.com/rest/api/1/rpc/getmininginfo`, `.../rpc/gettxoutsetinfo`, `.../coingecko/price` |
| `fetch_explorer_blocks` | Recent blocks table on Dashboard. | `.../rest/api/1/block?limit=N` |
| `fetch_explorer_transactions` | Network tx fallback on Transactions page. | `.../rest/api/1/transaction?limit=N` |
| `fetch_explorer_extraction` | Top miners on Network page. | `.../rest/api/1/extraction?limit=N` |
| `fetch_explorer_chain_tips` | Chain tip / fork list on Network page. | `.../rest/api/1/chain` |
| `get_explorer_logo_url` | Sidebar logo URL constant. | `https://explorer-vrm.vericonomy.com/assets/images/logo.png` |
| `is_explorer_api_enabled` | Reports the `EXPLORER_API_ENABLED` Rust flag to the frontend. | n/a |

### Explorer URL templates

The legacy Qt wallet stores `strThirdPartyTxUrls` in `QSettings`
([`src/qt/optionsmodel.cpp`](../src/qt/optionsmodel.cpp)). The new app stores
the equivalent in
[`desktop/verium-app/src/lib/user-preferences.ts`](../desktop/verium-app/src/lib/user-preferences.ts):

| Preference | Default |
| --- | --- |
| `explorer_tx_url_template` | `https://explorer-vrm.vericonomy.com/#tx/%s` |
| `explorer_block_url_template` | `https://explorer-vrm.vericonomy.com/#block/%s` |
| `explorer_address_url_template` | `https://explorer-vrm.vericonomy.com/#address/%s` |

The `%s` placeholder is replaced with the txid, block hash or height, or
address. Users can override every template in Settings.

## Known gaps

| Gap | Workaround |
| --- | --- |
| No mining "active" flag in `getmininginfo`. | Track locally after `minerstart`/`minerstop`; infer from `hashrate > 0`. |
| No log-streaming RPC. | Tauri tails `<datadir>/debug.log` via `notify`. |
| No get/update-config RPC. | Tauri reads and writes `verium.conf`; backup before write. |
| No bootstrap progress events from RPC. | Tail `debug.log` for `bootstrap:` lines during the download. |
| Regtest is currently disabled in chain parameters. | Do not expose a regtest toggle in the UI until reenabled. |
| `verium-qt` does not default `server=1`. | The new app spawns `veriumd`, not `verium-qt`. |

## Example invocations

```sh
verium-cli -datadir=/path/to/datadir getblockchaininfo
verium-cli -datadir=/path/to/datadir getmininginfo
verium-cli -datadir=/path/to/datadir minerstart 4
verium-cli -datadir=/path/to/datadir -rpcwallet=mywallet getbalance
verium-cli -datadir=/path/to/datadir stop
```

```sh
curl --user "__cookie__:$(cat /path/to/datadir/.cookie | cut -d: -f2)" \
     --data-binary '{"jsonrpc":"1.0","id":"matrix","method":"getblockchaininfo","params":[]}' \
     -H 'content-type: application/json' \
     http://127.0.0.1:33987/
```
