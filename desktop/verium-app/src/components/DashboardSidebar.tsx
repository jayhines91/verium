import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { ExplorerLink } from "@/components/ExplorerLink";
import { YourMiningPanel } from "@/components/YourMiningPanel";
import { fetchExplorerStats, isExplorerApiEnabled } from "@/lib/explorer-api";
import { EXPLORER_HOME } from "@/lib/verium-links";
import { networkHashToKhm } from "@/lib/mining-revenue";
import { rpcGetMiningInfo, rpcGetWalletInfo } from "@/lib/rpc/client";
import { formatNumber, formatVrm } from "@/lib/utils";

function formatUsd(value?: number): string {
  if (value === undefined || value === null) return "—";
  if (value >= 1_000_000) return `$${formatNumber(value / 1_000_000, 2)}M`;
  if (value >= 1_000) return `$${formatNumber(value / 1_000, 2)}K`;
  return `$${formatNumber(value, 4)}`;
}

interface DashboardSidebarProps {
  localHeight?: number;
}

export function DashboardSidebar({ localHeight }: DashboardSidebarProps) {
  const wallet = useQuery({
    queryKey: ["getwalletinfo"],
    queryFn: rpcGetWalletInfo,
    refetchInterval: 10_000,
  });
  const mining = useQuery({
    queryKey: ["getmininginfo"],
    queryFn: rpcGetMiningInfo,
    refetchInterval: 10_000,
  });
  const explorerEnabled = useQuery({
    queryKey: ["explorer-api-enabled"],
    queryFn: isExplorerApiEnabled,
    staleTime: Infinity,
  });
  const stats = useQuery({
    queryKey: ["explorer-stats"],
    queryFn: fetchExplorerStats,
    enabled: explorerEnabled.data === true,
    refetchInterval: 60_000,
    retry: 0,
  });

  const explorerHeight = stats.data?.height;
  const heightDelta =
    localHeight != null && explorerHeight != null
      ? localHeight - explorerHeight
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <YourMiningPanel />

      <Card>
        <CardHeader>
          <CardTitle>Wallet</CardTitle>
          <CardDescription>Quick snapshot</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          <MiniStat
            label="Balance"
            value={wallet.data ? formatVrm(wallet.data.balance, 4) : "—"}
          />
          <MiniStat
            label="Unconfirmed"
            value={
              wallet.data
                ? formatVrm(wallet.data.unconfirmed_balance, 4)
                : "—"
            }
          />
          <MiniStat
            label="Immature"
            value={
              wallet.data ? formatVrm(wallet.data.immature_balance, 4) : "—"
            }
          />
          <MiniStat
            label="Transactions"
            value={
              wallet.data ? formatNumber(wallet.data.txcount, 0) : "—"
            }
          />
        </CardContent>
        <div className="border-t border-border px-4 py-2">
          <Link
            to="/wallet"
            className="text-xs text-accent underline underline-offset-2"
          >
            Open wallet →
          </Link>
        </div>
      </Card>

      {explorerEnabled.data === true && (
        <Card>
          <CardHeader className="flex-row items-start justify-between pb-2">
            <CardTitle className="text-base">Market</CardTitle>
            <ExplorerLink target={{ kind: "raw", url: EXPLORER_HOME }} label="Explorer" />
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-sm">
            <MiniStat label="VRM" value={formatUsd(stats.data?.price_usd)} />
            <MiniStat
              label="24h vol"
              value={formatUsd(stats.data?.volume_24h_usd)}
            />
            <MiniStat
              label="Reward"
              value={
                stats.data?.block_reward != null
                  ? `${formatNumber(stats.data.block_reward, 4)} VRM`
                  : "—"
              }
            />
            <MiniStat
              label="Supply"
              value={
                stats.data?.supply != null
                  ? `${formatNumber(stats.data.supply, 0)}`
                  : "—"
              }
            />
          </CardContent>
        </Card>
      )}

      {explorerEnabled.data === true && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Network compare</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Row
              label="Local height"
              value={localHeight != null ? formatNumber(localHeight) : "—"}
            />
            <Row
              label="Explorer height"
              value={
                explorerHeight != null ? formatNumber(explorerHeight) : "—"
              }
            />
            <Row
              label="Delta"
              value={
                heightDelta != null
                  ? `${heightDelta >= 0 ? "+" : ""}${formatNumber(heightDelta)}`
                  : "—"
              }
            />
            <Row
              label="Net hashrate"
              value={
                stats.data?.network_hash != null
                  ? `${formatNumber(networkHashToKhm(stats.data.network_hash), 1)} kH/m`
                  : mining.data
                    ? `${formatNumber(networkHashToKhm(mining.data.networkhashps), 1)} kH/m`
                    : "—"
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-fg-muted">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
