import { BootstrapBanner } from "@/components/BootstrapBanner";
import { BackupHealthCard } from "@/components/BackupHealthCard";
import { DashboardHero } from "@/components/DashboardHero";
import { DashboardMiddleRow } from "@/components/DashboardMiddleRow";
import { ExplorerRecentBlocks } from "@/components/ExplorerRecentBlocks";
import { useActiveCoin } from "@/lib/coin/context";
import { useIsTestNetwork } from "@/lib/network-mode";

export function Dashboard() {
  const coin = useActiveCoin();
  const isTestNetwork = useIsTestNetwork();

  return (
    <div className="flex flex-col gap-4">
      <BootstrapBanner />
      <DashboardHero coin={coin} />
      <DashboardMiddleRow coin={coin} />
      {!isTestNetwork && (
        <ExplorerRecentBlocks coin={coin} variant="dashboard" />
      )}
      <BackupHealthCard />
    </div>
  );
}
