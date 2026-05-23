import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Pickaxe } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  buildNetworkStats,
  estimateDailyMining,
  estimateHoursPerBlock,
  formatSessionDuration,
  networkSharePercent,
} from "@/lib/mining-revenue";
import { fetchExplorerStats, isExplorerApiEnabled } from "@/lib/explorer-api";
import {
  rpcGetMinerState,
  rpcGetMiningInfo,
  rpcGetWalletInfo,
  rpcListTransactions,
} from "@/lib/rpc/client";
import { formatNumber, formatVrm } from "@/lib/utils";

export function YourMiningPanel() {
  const mining = useQuery({
    queryKey: ["getmininginfo"],
    queryFn: rpcGetMiningInfo,
    refetchInterval: 5_000,
  });
  const minerState = useQuery({
    queryKey: ["get_miner_state"],
    queryFn: rpcGetMinerState,
    refetchInterval: 5_000,
  });
  const wallet = useQuery({
    queryKey: ["getwalletinfo"],
    queryFn: rpcGetWalletInfo,
    refetchInterval: 10_000,
  });
  const txs = useQuery({
    queryKey: ["listtransactions", "mining-panel"],
    queryFn: () => rpcListTransactions(50, 0),
    refetchInterval: 30_000,
  });
  const explorerEnabled = useQuery({
    queryKey: ["explorer-api-enabled"],
    queryFn: isExplorerApiEnabled,
    staleTime: Infinity,
  });
  const explorerStats = useQuery({
    queryKey: ["explorer-stats"],
    queryFn: fetchExplorerStats,
    enabled: explorerEnabled.data === true,
    refetchInterval: 30_000,
    retry: 0,
  });

  const localHashrate = mining.data?.hashrate ?? 0;
  const networkStats = buildNetworkStats(explorerStats.data, mining.data);
  const blocksFound =
    txs.data?.filter(
      (t) => t.category === "generate" || t.category === "immature",
    ).length ?? 0;
  const immature = wallet.data?.immature_balance ?? 0;
  const active = minerState.data?.active ?? false;
  const share = networkSharePercent(localHashrate, networkStats?.networkHash);
  const estBlockH = estimateHoursPerBlock(localHashrate, networkStats);
  const daily =
    networkStats && localHashrate > 0
      ? estimateDailyMining({
          localHashrateHm: localHashrate,
          networkHashrateHs: networkStats.networkHash!,
          blocksPerHour: networkStats.blocksPerHour!,
          blockReward: networkStats.blockReward!,
          priceUsd: networkStats.priceUsd,
        })
      : null;

  const miningAny =
    active || localHashrate > 0 || blocksFound > 0 || immature > 0;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Pickaxe className="h-4 w-4" /> Your mining
          </CardTitle>
          <CardDescription>
            Solo CPU mining activity on this wallet.
          </CardDescription>
        </div>
        {active && <Badge tone="success">Mining</Badge>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!miningAny ? (
          <div className="flex flex-col gap-3 rounded-md border border-dashed border-border px-4 py-5 text-center">
            <p className="text-sm text-fg-muted">
              No blocks found yet. Start the built-in miner to earn VRM.
            </p>
            <Link to="/mining">
              <Button size="sm">Start mining</Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Blocks found" value={formatNumber(blocksFound, 0)} />
            <Stat
              label="Pending (immature)"
              value={formatVrm(immature, 4)}
            />
            <Stat
              label="Hashrate"
              value={
                localHashrate > 0
                  ? `${formatNumber(localHashrate, 0)} H/m`
                  : "—"
              }
            />
            <Stat
              label="Network share"
              value={share != null ? `${formatNumber(share, 2)}%` : "—"}
            />
            {active && minerState.data?.started_at && (
              <Stat
                label="Session"
                value={formatSessionDuration(minerState.data.started_at)}
              />
            )}
            <Stat
              label="Est. next block"
              value={estBlockH != null ? `${formatNumber(estBlockH, 1)} h` : "—"}
            />
            {daily && (
              <Stat
                label="Est. daily"
                value={`${formatNumber(daily.vrmPerDay, 3)} VRM`}
              />
            )}
          </div>
        )}
        <Link
          to="/mining"
          className="text-xs text-accent underline underline-offset-2"
        >
          Open mining page →
        </Link>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-subtle/50 px-3 py-2">
      <div className="text-xs uppercase text-fg-subtle">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
