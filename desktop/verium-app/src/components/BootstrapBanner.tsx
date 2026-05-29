import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HardDriveDownload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BootstrapDialog } from "@/components/BootstrapDialog";
import { coinQueryKey } from "@/lib/coin/profile";
import { useActiveCoin } from "@/lib/coin/context";
import { rpcGetBlockchainInfo, rpcGetPeerInfo } from "@/lib/rpc/client";
import {
  blocksBehindNetwork,
  shouldOfferBootstrap,
  syncTargetHeight,
} from "@/lib/bootstrap-policy";
import { fetchExplorerStats } from "@/lib/explorer-api";
import { useIsTestNetwork } from "@/lib/network-mode";
import { useUserPreferences } from "@/lib/user-preferences";
import { formatNumber, formatPercent } from "@/lib/utils";

export function BootstrapBanner() {
  const coin = useActiveCoin();
  const isTestNetwork = useIsTestNetwork();
  const [dialogOpen, setDialogOpen] = useState(false);
  const prefs = useUserPreferences((s) => s.prefs);
  const updatePrefs = useUserPreferences((s) => s.update);

  const blockchain = useQuery({
    queryKey: coinQueryKey(coin, "getblockchaininfo"),
    queryFn: () => rpcGetBlockchainInfo(coin),
    refetchInterval: 15_000,
    enabled: !isTestNetwork,
  });
  const peers = useQuery({
    queryKey: coinQueryKey(coin, "getpeerinfo"),
    queryFn: () => rpcGetPeerInfo(coin),
    refetchInterval: 15_000,
    enabled: !isTestNetwork,
  });
  const explorer = useQuery({
    queryKey: coinQueryKey(coin, "explorer-stats"),
    queryFn: () => fetchExplorerStats(coin),
    refetchInterval: 30_000,
    retry: 0,
    enabled: !isTestNetwork,
  });

  // Binarytest has no canonical snapshot CDN — never offer bootstrap.
  if (isTestNetwork) return null;

  const networkTip = explorer.data?.height;
  const offer = shouldOfferBootstrap(
    blockchain.data,
    peers.data,
    prefs.bootstrap_dismissed_at,
    networkTip,
  );

  if (!offer) return null;

  const localBlocks = blockchain.data?.blocks;
  const progress = blockchain.data?.verificationprogress ?? 0;
  const target = syncTargetHeight(blockchain.data, networkTip);
  const behind = blocksBehindNetwork(localBlocks, target);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
      <HardDriveDownload className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="flex flex-1 flex-col gap-2">
        <div className="space-y-1 text-warning">
          <div>
            Your chain is far behind the network. Importing the official
            bootstrap snapshot can jump you ahead faster than catching up over
            P2P. Dashboard block counts show your local verified height until
            sync completes.
          </div>
          {localBlocks != null && (
            <div className="text-xs text-fg-muted">
              Local block #{formatNumber(localBlocks, 0)}
              {target != null && (
                <> · network tip ~#{formatNumber(target, 0)}</>
              )}
              {behind != null && behind > 0 && (
                <> · ~{formatNumber(behind, 0)} blocks remaining</>
              )}
              {" · "}
              {formatPercent(progress, 0)} verified
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            Import bootstrap
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void updatePrefs({
                bootstrap_dismissed_at: Math.floor(Date.now() / 1000),
              })
            }
          >
            <X className="h-3.5 w-3.5" /> Snooze for a day
          </Button>
        </div>
      </div>
      <BootstrapDialog
        coin={coin}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
