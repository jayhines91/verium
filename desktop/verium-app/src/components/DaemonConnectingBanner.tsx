import { Loader2 } from "lucide-react";
import { getCoinProfile, type CoinId } from "@/lib/coin/profile";

export function DaemonConnectingBanner({ coin }: { coin: CoinId }) {
  const profile = getCoinProfile(coin);
  return (
    <div className="rounded-lg border border-border bg-bg-subtle px-4 py-3 text-sm text-fg">
      <div className="flex items-center gap-2 font-medium">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
        Starting {profile.displayName} node…
      </div>
      <p className="mt-1 text-xs text-fg-muted">
        Connecting to {profile.binaryName} on your machine. This can take up to
        a minute while the chain index loads.
      </p>
    </div>
  );
}
