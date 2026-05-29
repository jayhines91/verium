import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey } from "@/lib/coin/profile";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { WalletUnlockForm } from "@/components/WalletUnlockForm";
import { UpgradeToHdCard } from "@/components/UpgradeToHdCard";
import { rpcGetWalletInfo } from "@/lib/rpc/client";
import {
  formatUnlockedUntil,
  isWalletEncrypted,
  isWalletLocked,
  isWalletUnlocked,
} from "@/lib/wallet-unlock";
import { formatNumber, formatVrm } from "@/lib/utils";

export function Wallet() {
  const coin = useActiveCoin();
  const wallet = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    refetchInterval: 5_000,
  });

  const locked = isWalletLocked(wallet.data);
  const encrypted = isWalletEncrypted(wallet.data);
  const unlocked = isWalletUnlocked(wallet.data);
  const unlockedUntil = wallet.data?.unlocked_until ?? 0;

  if (wallet.isLoading) {
    return (
      <div className="py-10 text-center text-sm text-fg-muted">
        Loading wallet…
      </div>
    );
  }

  if (!wallet.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Wallet unavailable</CardTitle>
          <CardDescription>
            Connect to your node and ensure a wallet is loaded.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (locked) {
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Immature</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tabular-nums">
                {formatVrm(wallet.data.immature_balance, 4)}
              </div>
              <div className="mt-1 text-xs text-fg-subtle">
                from recently mined blocks
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="py-6">
            <WalletUnlockForm
              title="Unlock your wallet"
              description="Enter your passphrase to view balances, receive addresses, and mine. Your passphrase is never stored."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <UpgradeToHdCard />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Spendable balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {formatVrm(wallet.data.balance, 4)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Unconfirmed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {formatVrm(wallet.data.unconfirmed_balance, 4)}
            </div>
            <div className="mt-1 text-xs text-fg-subtle">
              incoming payments still confirming
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Immature</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {formatVrm(wallet.data.immature_balance, 4)}
            </div>
            <div className="mt-1 text-xs text-fg-subtle">
              from recently mined blocks
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>
            Encryption and unlock state. Passphrase is never stored.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-fg-muted">Status:</span>
            {!encrypted ? (
              <Badge tone="warning">Unencrypted</Badge>
            ) : unlocked ? (
              <Badge tone="success">
                Unlocked {formatUnlockedUntil(unlockedUntil)}
              </Badge>
            ) : (
              <Badge tone="neutral">Locked</Badge>
            )}
          </div>
        </CardContent>
        <CardFooter className="text-xs text-fg-subtle">
          {`Keypool size: ${formatNumber(wallet.data.keypoolsize ?? 0)}`}
        </CardFooter>
      </Card>
    </div>
  );
}
