import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { WalletUnlockForm } from "@/components/WalletUnlockForm";
import { coinQueryKey } from "@/lib/coin/profile";
import { useActiveCoin } from "@/lib/coin/context";
import { rpcGetWalletInfo } from "@/lib/rpc/client";
import { isWalletLocked } from "@/lib/wallet-unlock";

interface WalletUnlockGateProps {
  children: ReactNode;
  title?: string;
  description?: string;
  mintingOnly?: boolean;
}

export function WalletUnlockGate({
  children,
  title,
  description,
  mintingOnly,
}: WalletUnlockGateProps) {
  const coin = useActiveCoin();
  const wallet = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    refetchInterval: 5_000,
  });

  if (wallet.isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-fg-muted">
          Loading wallet…
        </CardContent>
      </Card>
    );
  }

  if (!wallet.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Wallet unavailable</CardTitle>
          <CardDescription>
            Connect to your node and ensure a wallet is loaded before using this
            page.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isWalletLocked(wallet.data)) {
    return (
      <Card>
        <CardContent className="py-6">
          <WalletUnlockForm
            title={title}
            description={description}
            mintingOnly={mintingOnly}
          />
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}
