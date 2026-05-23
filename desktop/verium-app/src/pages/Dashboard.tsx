import { useQuery } from "@tanstack/react-query";
import { BootstrapBanner } from "@/components/BootstrapBanner";
import { DashboardHero } from "@/components/DashboardHero";
import { DashboardStrip } from "@/components/DashboardStrip";
import { ExplorerRecentBlocks } from "@/components/ExplorerRecentBlocks";
import { rpcGetBlockchainInfo } from "@/lib/rpc/client";

export function Dashboard() {
  const blockchain = useQuery({
    queryKey: ["getblockchaininfo"],
    queryFn: rpcGetBlockchainInfo,
    refetchInterval: 5_000,
  });

  return (
    <div className="flex flex-col gap-4">
      <BootstrapBanner />
      <DashboardHero />
      <DashboardStrip />
      <ExplorerRecentBlocks
        localTipHeight={blockchain.data?.blocks}
        variant="dashboard"
      />
    </div>
  );
}
