import { useQuery } from "@tanstack/react-query";
import { BootstrapBanner } from "@/components/BootstrapBanner";
import { BackupHealthCard } from "@/components/BackupHealthCard";
import { DashboardHero } from "@/components/DashboardHero";
import { DashboardStrip } from "@/components/DashboardStrip";
import { ExplorerRecentBlocks } from "@/components/ExplorerRecentBlocks";
import { NetworkPulse } from "@/components/NetworkPulse";
import { coinQueryKey, getCoinProfile } from "@/lib/coin/profile";
import { useActiveCoin } from "@/lib/coin/context";
import { rpcGetBlockchainInfo, rpcGetMiningInfo } from "@/lib/rpc/client";

export function Dashboard() {
  const coin = useActiveCoin();
  const profile = getCoinProfile(coin);

  const blockchain = useQuery({
    queryKey: coinQueryKey(coin, "getblockchaininfo"),
    queryFn: () => rpcGetBlockchainInfo(coin),
    refetchInterval: 5_000,
  });
  const vrmMining = useQuery({
    queryKey: coinQueryKey("verium", "getmininginfo"),
    queryFn: () => rpcGetMiningInfo("verium"),
    refetchInterval: 10_000,
    enabled: coin === "verium",
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{profile.displayName} dashboard</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {coin === "verium"
            ? "Sync status, mining, wallet balance, and recent VRM activity."
            : "Sync status, staking, wallet balance, and recent VRC activity."}
        </p>
      </div>
      <BootstrapBanner />
      <DashboardHero coin={coin} />
      <DashboardStrip coin={coin} />
      <NetworkPulse
        coin={coin}
        localHeight={blockchain.data?.blocks}
        localNetworkHash={
          coin === "verium" ? vrmMining.data?.networkhashps : undefined
        }
      />
      <ExplorerRecentBlocks
        coin={coin}
        localTipHeight={blockchain.data?.blocks}
        variant="dashboard"
      />
      <BackupHealthCard />
    </div>
  );
}
