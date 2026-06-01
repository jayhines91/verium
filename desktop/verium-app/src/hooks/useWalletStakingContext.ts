import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { coinQueryKey } from "@/lib/coin/profile";
import { useWindowVisible } from "@/hooks/useWindowVisible";
import { useWalletTransactions } from "@/hooks/useWalletTransactions";
import { rpcListAddressGroupings } from "@/lib/rpc/client";

const VERICOIN = "vericoin" as const;

export function useWalletStakingContext(enabled = true) {
  const visible = useWindowVisible();
  const addresses = useQuery({
    queryKey: coinQueryKey(VERICOIN, "listaddressgroupings"),
    queryFn: () => rpcListAddressGroupings(VERICOIN),
    refetchInterval: visible ? 10_000 : false,
    retry: 0,
    enabled,
  });

  const txs = useWalletTransactions(VERICOIN, { enabled });

  return useMemo(() => {
    const walletAddresses = new Set<string>(addresses.data ?? []);
    const stakedHeights = new Set<number>();

    for (const tx of txs.data ?? []) {
      if (tx.category === "stake-mint") {
        if (tx.address) walletAddresses.add(tx.address);
        if (tx.blockheight != null) stakedHeights.add(tx.blockheight);
      }
    }

    return { walletAddresses, stakedHeights };
  }, [addresses.data, txs.data]);
}

export function isBlockStakedByWallet(
  block: { height: number; miner_address?: string },
  ctx: { walletAddresses: Set<string>; stakedHeights: Set<number> },
): boolean {
  if (ctx.stakedHeights.has(block.height)) return true;
  if (
    block.miner_address &&
    ctx.walletAddresses.has(block.miner_address)
  ) {
    return true;
  }
  return false;
}
