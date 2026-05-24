import fs from "fs";
import path from "path";

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
const appRoot = path.join(root, "..");

const files = [
  "src/pages/Mining.tsx",
  "src/pages/Wallet.tsx",
  "src/pages/Transactions.tsx",
  "src/pages/Network.tsx",
  "src/pages/Logs.tsx",
  "src/pages/RpcConsole.tsx",
  "src/pages/SignVerify.tsx",
  "src/components/WalletBalanceSummary.tsx",
  "src/components/CoinControlDialog.tsx",
  "src/components/ReceivePanel.tsx",
  "src/components/WalletCreateForm.tsx",
  "src/components/WalletImportForm.tsx",
  "src/components/WalletBackupCard.tsx",
  "src/pages/AddressBook.tsx",
  "src/components/AddressBookPicker.tsx",
  "src/components/DashboardSidebar.tsx",
  "src/components/YourMiningPanel.tsx",
  "src/components/ExplorerPeersPanel.tsx",
];

function patch(content) {
  let s = content;

  if (!s.includes("useActiveCoin") && s.includes("@/lib/rpc/client")) {
    s = s.replace(
      /(import[^\n]+from "@\/lib\/rpc\/client";?\n)/,
      '$1import { useActiveCoin } from "@/lib/coin/context";\nimport { coinQueryKey } from "@/lib/coin/profile";\n',
    );
  }

  if (!s.includes("const coin = useActiveCoin()")) {
    s = s.replace(
      /export function (\w+)\(\) \{\n/,
      "export function $1() {\n  const coin = useActiveCoin();\n",
    );
  }

  const replacements = [
    [/queryKey: \["getwalletinfo"\]/g, 'queryKey: coinQueryKey(coin, "getwalletinfo")'],
    [/queryKey: \["getblockchaininfo"\]/g, 'queryKey: coinQueryKey(coin, "getblockchaininfo")'],
    [/queryKey: \["getnetworkinfo"\]/g, 'queryKey: coinQueryKey(coin, "getnetworkinfo")'],
    [/queryKey: \["getpeerinfo"\]/g, 'queryKey: coinQueryKey(coin, "getpeerinfo")'],
    [/queryKey: \["getmininginfo"\]/g, 'queryKey: coinQueryKey(coin, "getmininginfo")'],
    [/queryKey: \["get_miner_state"\]/g, 'queryKey: coinQueryKey(coin, "get_miner_state")'],
    [/queryKey: \["listtransactions"\]/g, 'queryKey: coinQueryKey(coin, "listtransactions")'],
    [/queryKey: \["listtransactions", "([^"]+)"\]/g, 'queryKey: coinQueryKey(coin, "listtransactions", "$1")'],
    [/queryKey: \["listaddressgroupings"\]/g, 'queryKey: coinQueryKey(coin, "listaddressgroupings")'],
    [/queryKey: \["listunspent"\]/g, 'queryKey: coinQueryKey(coin, "listunspent")'],
    [/queryKey: \["wallet-file-status"\]/g, 'queryKey: coinQueryKey(coin, "wallet-file-status")'],
    [/queryKey: \["daemon-config"\]/g, 'queryKey: coinQueryKey(coin, "daemon-config")'],
    [/queryKey: \["detect-veriumd"\]/g, 'queryKey: coinQueryKey(coin, "detect-daemon")'],
    [/queryKey: \["address-book"\]/g, 'queryKey: coinQueryKey(coin, "address-book")'],
    [/queryKey: \["explorer-stats"\]/g, 'queryKey: coinQueryKey(coin, "explorer-stats")'],
    [/queryKey: \["explorer-blocks", ([^\]]+)\]/g, 'queryKey: coinQueryKey(coin, "explorer-blocks", $1)'],
    [/queryKey: \["explorer-transactions"\]/g, 'queryKey: coinQueryKey(coin, "explorer-transactions")'],
    [/queryKey: \["getaddednodeinfo"\]/g, 'queryKey: coinQueryKey(coin, "getaddednodeinfo")'],
    [/queryFn: rpcGetWalletInfo/g, "queryFn: () => rpcGetWalletInfo(coin)"],
    [/queryFn: rpcGetBlockchainInfo/g, "queryFn: () => rpcGetBlockchainInfo(coin)"],
    [/queryFn: rpcGetNetworkInfo/g, "queryFn: () => rpcGetNetworkInfo(coin)"],
    [/queryFn: rpcGetPeerInfo/g, "queryFn: () => rpcGetPeerInfo(coin)"],
    [/queryFn: rpcGetMiningInfo/g, "queryFn: () => rpcGetMiningInfo(coin)"],
    [/queryFn: rpcGetMinerState/g, "queryFn: () => rpcGetMinerState(coin)"],
    [/queryFn: rpcGetConfig/g, "queryFn: () => rpcGetConfig(coin)"],
    [/queryFn: tauriDetectVeriumd/g, "queryFn: () => tauriDetectDaemon(coin)"],
    [/queryFn: tauriWalletFileStatus/g, "queryFn: () => tauriWalletFileStatus(coin)"],
    [/queryFn: rpcListAddressGroupings/g, "queryFn: () => rpcListAddressGroupings(coin)"],
    [/queryFn: rpcWalletListUnspent/g, "queryFn: () => rpcWalletListUnspent(coin)"],
    [/queryFn: fetchExplorerStats/g, "queryFn: () => fetchExplorerStats(coin)"],
    [/queryFn: \(\) => fetchExplorerBlocks\(([^)]+)\)/g, "queryFn: () => fetchExplorerBlocks(coin, $1)"],
    [/queryFn: \(\) => fetchExplorerTransactions\(([^)]+)\)/g, "queryFn: () => fetchExplorerTransactions(coin, $1)"],
    [/queryFn: \(\) => rpcListTransactions\(([^,)]+), ([^)]+)\)/g, "queryFn: () => rpcListTransactions(coin, $1, $2)"],
    [/queryFn: \(\) => listAddressBookEntries\(\)/g, "queryFn: () => listAddressBookEntries(coin)"],
    [/queryFn: \(\) => tauriTailLogs\(([^)]+)\)/g, "queryFn: () => tauriTailLogs(coin, $1)"],
    [/useDaemonStatus\(\)/g, "useDaemonStatus(coin)"],
    [/invalidateQueries\(\{ queryKey: \["getwalletinfo"\] \}\)/g, 'invalidateQueries({ queryKey: coinQueryKey(coin, "getwalletinfo") })'],
    [/invalidateQueries\(\{ queryKey: \["getmininginfo"\] \}\)/g, 'invalidateQueries({ queryKey: coinQueryKey(coin, "getmininginfo") })'],
    [/invalidateQueries\(\{ queryKey: \["get_miner_state"\] \}\)/g, 'invalidateQueries({ queryKey: coinQueryKey(coin, "get_miner_state") })'],
    [/invalidateQueries\(\{ queryKey: \["listtransactions"\] \}\)/g, 'invalidateQueries({ queryKey: coinQueryKey(coin, "listtransactions") })'],
    [/invalidateQueries\(\{ queryKey: \["listunspent"\] \}\)/g, 'invalidateQueries({ queryKey: coinQueryKey(coin, "listunspent") })'],
    [/invalidateQueries\(\{ queryKey: \["address-book"\] \}\)/g, 'invalidateQueries({ queryKey: coinQueryKey(coin, "address-book") })'],
    [/setQueryData\(\["get_miner_state"\]/g, 'setQueryData(coinQueryKey(coin, "get_miner_state")'],
    [/mutationFn: rpcMinerStop/g, "mutationFn: () => rpcMinerStop(coin)"],
    [/mutationFn: \(\) => rpcMinerStart\(/g, "mutationFn: () => rpcMinerStart(coin, "],
    [/mutationFn: rpcSetConfig/g, "mutationFn: (partial) => rpcSetConfig(coin, partial)"],
    [/mutationFn: tauriEnsureFirstRun/g, "mutationFn: () => tauriEnsureFirstRun(coin)"],
    [/mutationFn: tauriStartDaemon/g, "mutationFn: () => tauriStartDaemon(coin)"],
    [/tauriEnsureDaemonConnected\(\)/g, "tauriEnsureDaemonConnected(coin)"],
    [/tauriDetectVeriumd/g, "tauriDetectDaemon"],
    [/tauriDetectVeriumdRuntime/g, "tauriDetectDaemonRuntime"],
  ];

  for (const [pattern, replacement] of replacements) {
    s = s.replace(pattern, replacement);
  }

  return s;
}

for (const f of files) {
  const p = path.join(appRoot, f);
  if (!fs.existsSync(p)) {
    console.log("skip", f);
    continue;
  }
  const original = fs.readFileSync(p, "utf8");
  const next = patch(original);
  if (next !== original) {
    fs.writeFileSync(p, next);
    console.log("updated", f);
  }
}
