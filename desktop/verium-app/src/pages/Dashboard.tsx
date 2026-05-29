import { useQuery } from "@tanstack/react-query";
import { BootstrapBanner } from "@/components/BootstrapBanner";
import { BackupHealthCard } from "@/components/BackupHealthCard";
import { DashboardHero } from "@/components/DashboardHero";
import { DashboardMiddleRow } from "@/components/DashboardMiddleRow";
import { DashboardStrip } from "@/components/DashboardStrip";
import { ExplorerRecentBlocks } from "@/components/ExplorerRecentBlocks";
import { NetworkPulse } from "@/components/NetworkPulse";
import { coinQueryKey } from "@/lib/coin/profile";
import { useActiveCoin } from "@/lib/coin/context";
import { useIsTestNetwork } from "@/lib/network-mode";
import { rpcGetBlockchainInfo } from "@/lib/rpc/client";

export function Dashboard() {
  const coin = useActiveCoin();
  const isTestNetwork = useIsTestNetwork();

  const blockchain = useQuery({
    queryKey: coinQueryKey(coin, "getblockchaininfo"),
    queryFn: () => rpcGetBlockchainInfo(coin),
    refetchInterval: 5_000,
  });

  return (
    <div className="flex flex-col gap-4">
      <BootstrapBanner />
      <DashboardHero coin={coin} />
      {coin === "verium" ? (
        <DashboardMiddleRow coin={coin} />
      ) : (
        <>
          <DashboardStrip coin={coin} />
          <NetworkPulse
            coin={coin}
            localHeight={blockchain.data?.blocks}
          />
        </>
      )}
      {!isTestNetwork && (
        <ExplorerRecentBlocks
          coin={coin}
          localTipHeight={blockchain.data?.blocks}
          variant="dashboard"
        />
      )}
      <BackupHealthCard />
    </div>
  );
}
