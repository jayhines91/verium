import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HardDriveDownload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BootstrapDialog } from "@/components/BootstrapDialog";
import { rpcGetBlockchainInfo, rpcGetPeerInfo } from "@/lib/rpc/client";
import { shouldOfferBootstrap } from "@/lib/bootstrap-policy";
import { useUserPreferences } from "@/lib/user-preferences";

export function BootstrapBanner() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const prefs = useUserPreferences((s) => s.prefs);
  const updatePrefs = useUserPreferences((s) => s.update);

  const blockchain = useQuery({
    queryKey: ["getblockchaininfo"],
    queryFn: rpcGetBlockchainInfo,
    refetchInterval: 15_000,
  });
  const peers = useQuery({
    queryKey: ["getpeerinfo"],
    queryFn: rpcGetPeerInfo,
    refetchInterval: 15_000,
  });

  const offer = shouldOfferBootstrap(
    blockchain.data,
    peers.data,
    prefs.bootstrap_dismissed_at,
  );

  if (!offer) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
      <HardDriveDownload className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="flex flex-1 flex-col gap-2">
        <div className="text-warning">
          Your chain is far behind the network. Importing the official
          bootstrap snapshot will sync much faster than catching up over P2P.
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
      <BootstrapDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
