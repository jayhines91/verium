import type { CoinId } from "@/lib/coin/profile";
import { Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ExplorerLink } from "@/components/ExplorerLink";
import {
  explorerExtractionHash,
  explorerPeersHash,
  explorerRichlistHash,
} from "@/lib/explorer-links";
import type { PeerInfo } from "@/lib/rpc/client";
import { formatNumber, formatRelativeTime } from "@/lib/utils";

interface NetworkLocalPeersCardProps {
  coin: CoinId;
  peers?: PeerInfo[];
}

export function NetworkLocalPeersCard({ coin, peers = [] }: NetworkLocalPeersCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 normal-case">
            <Users className="h-4 w-4 text-fg-subtle" aria-hidden />
            Connected peers
          </CardTitle>
          <CardDescription>
            Live connections from your local node (
            <span className="font-mono text-xs">getpeerinfo</span>).
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
        {peers.length === 0 ? (
          <div className="mx-5 mb-5 rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-fg-muted">
            No peers connected. Check firewall and P2P port if this persists.
          </div>
        ) : (
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-bg-panel text-xs uppercase text-fg-subtle shadow-[0_1px_0_var(--border)]">
                <tr>
                  <th className="px-5 py-2.5 text-left font-medium">Address</th>
                  <th className="px-5 py-2.5 text-left font-medium">Dir</th>
                  <th className="px-5 py-2.5 text-right font-medium">Headers</th>
                  <th className="px-5 py-2.5 text-right font-medium">Common</th>
                  <th className="px-5 py-2.5 text-right font-medium">Ping</th>
                  <th className="px-5 py-2.5 text-right font-medium">Since</th>
                  <th className="px-5 py-2.5 text-left font-medium">Client</th>
                </tr>
              </thead>
              <tbody>
                {peers.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-border transition-colors hover:bg-bg-subtle/40"
                  >
                    <td className="max-w-[10rem] truncate px-5 py-2.5 font-mono text-xs">
                      {p.addr}
                    </td>
                    <td className="px-5 py-2.5">
                      <Badge tone={p.inbound ? "neutral" : "accent"}>
                        {p.inbound ? "in" : "out"}
                      </Badge>
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {p.synced_headers != null
                        ? formatNumber(p.synced_headers)
                        : "—"}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {formatNumber(p.synced_blocks)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-fg-muted">
                      {p.pingtime
                        ? `${formatNumber(p.pingtime * 1000, 0)} ms`
                        : "—"}
                    </td>
                    <td className="px-5 py-2.5 text-right text-xs text-fg-muted">
                      {formatRelativeTime(p.conntime)}
                    </td>
                    <td className="max-w-[8rem] truncate px-5 py-2.5 text-xs text-fg-muted">
                      {p.subver}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
