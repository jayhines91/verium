import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ExplorerLink } from "@/components/ExplorerLink";
import { ExplorerPeersPanel } from "@/components/ExplorerPeersPanel";
import {
  fetchExplorerChainTips,
  fetchExplorerExtraction,
  fetchExplorerStats,
  isExplorerApiEnabled,
} from "@/lib/explorer-api";
import {
  explorerExtractionHash,
  explorerPeersHash,
  explorerRichlistHash,
} from "@/lib/explorer-links";
import {
  rpcGetBlockchainInfo,
  rpcGetNetworkInfo,
  rpcGetPeerInfo,
  type PeerInfo,
} from "@/lib/rpc/client";
import { formatNumber, formatRelativeTime } from "@/lib/utils";

function chainTipTone(status?: string): "success" | "warning" | "neutral" {
  if (!status) return "neutral";
  if (status === "valid-fork") return "warning";
  if (status === "valid-headers") return "neutral";
  if (status.startsWith("valid")) return "neutral";
  return "neutral";
}

function chainTipLabel(status?: string): string {
  switch (status) {
    case "valid-fork":
      return "Side fork (not active chain)";
    case "valid-headers":
      return "Headers only (not active chain)";
    default:
      return status ?? "unknown";
  }
}

export function Network() {
  const coin = useActiveCoin();
  const network = useQuery({
    queryKey: coinQueryKey(coin, "getnetworkinfo"),
    queryFn: () => rpcGetNetworkInfo(coin),
    refetchInterval: 5_000,
  });
  const peers = useQuery({
    queryKey: coinQueryKey(coin, "getpeerinfo"),
    queryFn: () => rpcGetPeerInfo(coin),
    refetchInterval: 5_000,
  });
  const blockchain = useQuery({
    queryKey: coinQueryKey(coin, "getblockchaininfo"),
    queryFn: () => rpcGetBlockchainInfo(coin),
    refetchInterval: 10_000,
  });

  const explorerEnabled = useQuery({
    queryKey: ["explorer-api-enabled"],
    queryFn: isExplorerApiEnabled,
    staleTime: Infinity,
  });

  const extraction = useQuery({
    queryKey: coinQueryKey(coin, "explorer-extraction"),
    queryFn: () => fetchExplorerExtraction(coin, 15),
    enabled: explorerEnabled.data === true,
    refetchInterval: 60_000,
    retry: 0,
  });

  const chainTips = useQuery({
    queryKey: coinQueryKey(coin, "explorer-chain-tips"),
    queryFn: () => fetchExplorerChainTips(coin),
    enabled: explorerEnabled.data === true,
    refetchInterval: 60_000,
    retry: 0,
  });

  const explorerStats = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    enabled: explorerEnabled.data === true,
    refetchInterval: 60_000,
    retry: 0,
  });

  const sortedChainTips = [...(chainTips.data ?? [])].sort(
    (a, b) => b.height - a.height || b.id - a.id,
  );

  const localHeight = blockchain.data?.blocks ?? 0;
  const headerHeight = blockchain.data?.headers ?? 0;
  const lag = Math.max(0, headerHeight - localHeight);
  const peerCount = Math.max(
    network.data?.connections ?? 0,
    peers.data?.length ?? 0,
  );
  const networkTip =
    explorerStats.data?.height && explorerStats.data.height > headerHeight
      ? explorerStats.data.height
      : headerHeight;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Connections</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {network.data || peers.data ? formatNumber(peerCount) : "—"}
            </div>
            <div className="mt-1 text-xs text-fg-subtle">
              {network.data?.networkactive
                ? "network active"
                : "network disabled"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Protocol</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {network.data?.protocolversion ?? "—"}
            </div>
            <div className="mt-1 truncate text-xs text-fg-subtle">
              {network.data?.subversion ?? ""}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Block Syncing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {headerHeight === 0 ? "—" : formatNumber(lag)}
            </div>
            <div className="mt-1 text-xs text-fg-subtle">
              blocks {formatNumber(localHeight)} / headers{" "}
              {headerHeight === 0 ? "—" : formatNumber(headerHeight)}
              {networkTip > headerHeight && (
                <> · network tip ~{formatNumber(networkTip)}</>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {explorerEnabled.data === true && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle>Top miners</CardTitle>
                <CardDescription>
                  Extraction leaderboard from the explorer REST API.
                </CardDescription>
              </div>
              <ExplorerLink
                coin={coin}
                target={{ kind: "raw", url: explorerExtractionHash(coin) }}
                label="Full list"
              />
            </CardHeader>
            <CardContent className="p-0">
              {extraction.isError ? (
                <div className="px-4 py-6 text-xs text-fg-subtle">
                  Could not load extraction data.
                </div>
              ) : (
                <div className="max-h-[320px] overflow-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 bg-bg-panel text-xs uppercase text-fg-subtle">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">
                          Rank
                        </th>
                        <th className="px-4 py-2 text-left font-medium">
                          Address
                        </th>
                        <th className="px-4 py-2 text-right font-medium">
                          Blocks
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(extraction.data ?? []).map((entry) => (
                        <tr
                          key={entry.address}
                          className="border-t border-border odd:bg-bg-subtle/30"
                        >
                          <td className="px-4 py-2 tabular-nums">
                            {entry.rank ?? "—"}
                          </td>
                          <td className="truncate px-4 py-2 font-mono text-xs">
                            <ExplorerLink
                              target={{
                                kind: "address",
                                address: entry.address,
                              }}
                              label={entry.address}
                            />
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {entry.count ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Alternate chain tips</CardTitle>
              <CardDescription>
                Side branches on <strong>mainnet</strong> that the network has
                seen but are <strong>not</strong> the active canonical chain (
                <span className="font-mono text-xs">valid-fork</span>,{" "}
                <span className="font-mono text-xs">valid-headers</span>). These
                are not testnet blocks. For the live main chain, see Dashboard →
                Recent blocks.
                {explorerStats.data?.height !== undefined && (
                  <>
                    {" "}
                    Current main chain height:{" "}
                    <span className="tabular-nums">
                      {formatNumber(explorerStats.data.height)}
                    </span>
                    .
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {chainTips.isError ? (
                <div className="px-4 py-6 text-xs text-fg-subtle">
                  Could not load chain tips.
                </div>
              ) : (
                <div className="max-h-[320px] overflow-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 bg-bg-panel text-xs uppercase text-fg-subtle">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">
                          Height
                        </th>
                        <th className="px-4 py-2 text-left font-medium">
                          Status
                        </th>
                        <th className="px-4 py-2 text-right font-medium">
                          Branch len
                        </th>
                        <th className="px-4 py-2 text-right font-medium">
                          Block
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedChainTips.slice(0, 15).map((tip) => (
                        <tr
                          key={tip.hash}
                          className="border-t border-border odd:bg-bg-subtle/30"
                        >
                          <td className="px-4 py-2 tabular-nums">
                            {formatNumber(tip.height)}
                          </td>
                          <td className="px-4 py-2">
                            <Badge
                              tone={chainTipTone(tip.status_name)}
                              title={chainTipLabel(tip.status_name)}
                            >
                              {tip.status_name ?? "unknown"}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {formatNumber(tip.branchlen)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <ExplorerLink
                              target={{
                                kind: "block",
                                hashOrHeight: tip.height,
                              }}
                              label="View"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <ExplorerPeersPanel />

      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle>Connected peers</CardTitle>
            <CardDescription>
              Live list from <span className="font-mono">getpeerinfo</span> on
              your local node.
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            <ExplorerLink
              coin={coin}
              target={{ kind: "raw", url: explorerPeersHash(coin) }}
              label="Peers on explorer"
            />
            <ExplorerLink
              coin={coin}
              target={{ kind: "raw", url: explorerExtractionHash(coin) }}
              label="Extraction stats"
            />
            <ExplorerLink
              coin={coin}
              target={{ kind: "raw", url: explorerRichlistHash(coin) }}
              label="Rich list"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-bg-panel text-xs uppercase text-fg-subtle">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Address</th>
                  <th className="px-4 py-2 text-left font-medium">Dir</th>
                  <th className="px-4 py-2 text-right font-medium">Headers</th>
                  <th className="px-4 py-2 text-right font-medium">Common</th>
                  <th className="px-4 py-2 text-right font-medium">Ping</th>
                  <th className="px-4 py-2 text-right font-medium">Conn.</th>
                  <th className="px-4 py-2 text-left font-medium">Subver</th>
                </tr>
              </thead>
              <tbody>
                {(peers.data ?? []).map((p: PeerInfo) => (
                  <tr
                    key={p.id}
                    className="border-t border-border odd:bg-bg-subtle/30"
                  >
                    <td className="truncate px-4 py-2 font-mono text-xs">
                      {p.addr}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={p.inbound ? "neutral" : "accent"}>
                        {p.inbound ? "in" : "out"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {p.synced_headers != null
                        ? formatNumber(p.synced_headers)
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatNumber(p.synced_blocks)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {p.pingtime
                        ? `${formatNumber(p.pingtime * 1000, 0)} ms`
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-fg-muted">
                      {formatRelativeTime(p.conntime)}
                    </td>
                    <td className="truncate px-4 py-2 text-xs text-fg-muted">
                      {p.subver}
                    </td>
                  </tr>
                ))}
                {peers.data && peers.data.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-6 text-center text-sm text-fg-subtle"
                    >
                      No peers connected.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
