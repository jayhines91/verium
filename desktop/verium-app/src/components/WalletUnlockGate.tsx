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
import { rpcGetWalletInfo } from "@/lib/rpc/client";
import { isWalletLocked } from "@/lib/wallet-unlock";

interface WalletUnlockGateProps {
  children: ReactNode;
  title?: string;
  description?: string;
}

/**
 * Blocks children until an encrypted wallet is unlocked. Unencrypted wallets
 * pass through immediately.
 */
export function WalletUnlockGate({
  children,
  title,
  description,
}: WalletUnlockGateProps) {
  const wallet = useQuery({
    queryKey: ["getwalletinfo"],
    queryFn: rpcGetWalletInfo,
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
          <WalletUnlockForm title={title} description={description} />
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}
