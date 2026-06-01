import type { CoinId } from "@/lib/coin/profile";
import type { ExplorerStats } from "@/lib/explorer-api";
import type {
  BlockchainInfo,
  NetworkInfo,
  VericoinMiningInfo,
} from "@/lib/rpc/client";
import {
  Activity,
  Coins,
  Cpu,
  Gauge,
  Globe,
  Layers,
  Percent,
  Server,
  TrendingUp,
  Zap,
} from "lucide-react";
import { MiningStatTile } from "@/components/MiningStatTile";
import { networkHashToKhm } from "@/lib/mining-revenue";
import {
  mergeStakingNetworkKpis,
  networkCoinsStakingPercent,
} from "@/lib/staking-stats";
import { formatNumber } from "@/lib/utils";

interface NetworkChainStatsProps {
  coin: CoinId;
  network?: NetworkInfo | null;
  blockchain?: BlockchainInfo | null;
  explorer?: ExplorerStats | null;
  localHashrate?: number;
  vrcMining?: VericoinMiningInfo | null;
  peerCount: number;
}

function formatUsd(value?: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `$${formatNumber(value / 1_000_000, 2)}M`;
  if (value >= 1_000) return `$${formatNumber(value / 1_000, 2)}K`;
  return `$${formatNumber(value, 4)}`;
}

export function NetworkChainStats({
  coin,
  network,
  blockchain,
  explorer,
  localHashrate,
  vrcMining,
  peerCount,
}: NetworkChainStatsProps) {
  const headerHeight = blockchain?.headers ?? blockchain?.blocks ?? 0;
  const localHeight = blockchain?.blocks ?? 0;
  const lag = Math.max(0, headerHeight - localHeight);

  if (coin === "verium") {
    const networkKhm =
      explorer?.network_hash != null
        ? networkHashToKhm(explorer.network_hash)
        : localHashrate != null
          ? formatNumber(localHashrate, 0)
          : null;

    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiningStatTile
          icon={Server}
          label="Connections"
          value={formatNumber(peerCount)}
          hint={network?.networkactive ? "Network active" : "Network disabled"}
        />
        <MiningStatTile
          icon={Layers}
          label="Protocol"
          value={network?.protocolversion ?? "—"}
          hint={network?.subversion?.replace(/^\//, "").replace(/\/$/, "")}
        />
        <MiningStatTile
          icon={Gauge}
          label="Header lag"
          value={headerHeight > 0 ? formatNumber(lag) : "—"}
          hint={
            headerHeight > 0
              ? `${formatNumber(localHeight)} / ${formatNumber(headerHeight)} blocks`
              : undefined
          }
        />
        <MiningStatTile
          icon={Globe}
          highlight
          label="Network hashrate"
          value={
            typeof networkKhm === "number"
              ? formatNumber(networkKhm, 2)
              : (networkKhm ?? "—")
          }
          unit={
            explorer?.network_hash != null
              ? "kH/m"
              : localHashrate != null
                ? "H/m"
                : undefined
          }
        />
        <MiningStatTile
          icon={Cpu}
          label="Difficulty"
          value={
            explorer?.difficulty != null
              ? formatNumber(explorer.difficulty, 7)
              : blockchain?.difficulty != null
                ? formatNumber(blockchain.difficulty, 7)
                : "—"
          }
        />
        <MiningStatTile
          icon={Zap}
          label="Block reward"
          value={
            explorer?.block_reward != null
              ? formatNumber(explorer.block_reward, 4)
              : "—"
          }
          unit="VRM"
        />
        <MiningStatTile
          icon={Coins}
          label="Supply"
          value={
            explorer?.supply != null ? formatNumber(explorer.supply, 2) : "—"
          }
          unit="VRM"
        />
        <MiningStatTile
          icon={TrendingUp}
          label="VRM price"
          value={formatUsd(explorer?.price_usd)}
        />
      </div>
    );
  }

  const staking = mergeStakingNetworkKpis(vrcMining, explorer);
  const stakePct = networkCoinsStakingPercent(staking.netStakeWeight);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MiningStatTile
        icon={Server}
        label="Connections"
        value={formatNumber(peerCount)}
        hint={network?.networkactive ? "Network active" : "Network disabled"}
      />
      <MiningStatTile
        icon={Layers}
        label="Protocol"
        value={network?.protocolversion ?? "—"}
        hint={network?.subversion?.replace(/^\//, "").replace(/\/$/, "")}
      />
      <MiningStatTile
        icon={Gauge}
        label="Header lag"
        value={headerHeight > 0 ? formatNumber(lag) : "—"}
        hint={
          headerHeight > 0
            ? `${formatNumber(localHeight)} / ${formatNumber(headerHeight)} blocks`
            : undefined
        }
      />
      <MiningStatTile
        icon={Percent}
        highlight
        label="Interest rate"
        value={
          staking.interestRate != null
            ? `${formatNumber(staking.interestRate, 2)}%`
            : "—"
        }
      />
      <MiningStatTile
        icon={Activity}
        label="Inflation"
        value={
          staking.inflationRate != null
            ? `${formatNumber(staking.inflationRate, 2)}%`
            : "—"
        }
      />
      <MiningStatTile
        icon={Globe}
        label="Network staked"
        value={stakePct != null ? `${formatNumber(stakePct, 2)}%` : "—"}
        hint={
          staking.netStakeWeight != null
            ? `${formatNumber(staking.netStakeWeight, 2)} weight`
            : undefined
        }
      />
      <MiningStatTile
        icon={Cpu}
        label="PoS difficulty"
        value={
          staking.posDifficulty != null
            ? formatNumber(staking.posDifficulty, 4)
            : "—"
        }
      />
      <MiningStatTile
        icon={Coins}
        label="Supply"
        value={staking.supply != null ? formatNumber(staking.supply, 2) : "—"}
        unit="VRC"
      />
      <MiningStatTile
        icon={TrendingUp}
        label="VRC price"
        value={formatUsd(explorer?.price_usd)}
      />
    </div>
  );
}
