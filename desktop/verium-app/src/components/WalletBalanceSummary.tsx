import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";
import { rpcGetWalletInfo, type WalletInfo } from "@/lib/rpc/client";
import { formatCoinAmount } from "@/lib/units";
import { coinMaturityConfirmations } from "@/lib/units";

function walletScanProgress(
  scanning: WalletInfo["scanning"],
): { duration: number; progress: number } | null {
  return typeof scanning === "object" ? scanning : null;
}

export function WalletBalanceSummary() {
  const coin = useActiveCoin();
  const wallet = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    refetchInterval: (query) => {
      return walletScanProgress(query.state.data?.scanning) ? 3_000 : 10_000;
    },
  });

  if (wallet.isLoading || !wallet.data) return null;

  const spendable = wallet.data.balance;
  const unconfirmed = wallet.data.unconfirmed_balance;
  const immature = wallet.data.immature_balance;
  const total = spendable + unconfirmed + immature;
  const scanning = walletScanProgress(wallet.data.scanning);
  const mature = coinMaturityConfirmations(coin);

  return (
    <div className="rounded-md border border-border bg-bg-subtle px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-fg-muted">Wallet total </span>
          <span className="text-lg font-semibold tabular-nums">
            {formatCoinAmount(total, coin, 4)}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
          <span>
            Spendable{" "}
            <span className="font-medium tabular-nums text-fg">
              {formatCoinAmount(spendable, coin, 4)}
            </span>
          </span>
          <span>
            Unconfirmed{" "}
            <span className="font-medium tabular-nums text-fg">
              {formatCoinAmount(unconfirmed, coin, 4)}
            </span>
          </span>
          <span>
            Immature{" "}
            <span className="font-medium tabular-nums text-fg">
              {formatCoinAmount(immature, coin, 4)}
            </span>
          </span>
        </div>
      </div>
      {scanning && (
        <div className="mt-2 flex items-center gap-2 text-xs text-warning">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Rescanning wallet…{" "}
          {Math.round((scanning.progress ?? 0) * 100)}% complete
        </div>
      )}
      <p className="mt-2 text-xs text-fg-subtle">
        Mined or staked rewards stay immature until {mature} confirmations.
      </p>
    </div>
  );
}
