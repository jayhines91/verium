import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { coinQueryKey } from "@/lib/coin/profile";
import {
  rpcListAddressGroupings,
  rpcListTransactions,
} from "@/lib/rpc/client";

const VERIUM = "verium" as const;

export function useWalletMiningContext() {
  const addresses = useQuery({
    queryKey: coinQueryKey(VERIUM, "listaddressgroupings"),
    queryFn: () => rpcListAddressGroupings(VERIUM),
    refetchInterval: 60_000,
    retry: 0,
  });

  const txs = useQuery({
    queryKey: coinQueryKey(VERIUM, "listtransactions", "wallet-mining-context"),
    queryFn: () => rpcListTransactions(VERIUM, 100, 0),
    refetchInterval: 30_000,
  });

  return useMemo(() => {
    const walletAddresses = new Set<string>(addresses.data ?? []);
    const minedHeights = new Set<number>();

    for (const tx of txs.data ?? []) {
      if (tx.category === "generate" || tx.category === "immature") {
        if (tx.address) walletAddresses.add(tx.address);
        if (tx.blockheight != null) minedHeights.add(tx.blockheight);
      }
    }

    return { walletAddresses, minedHeights };
  }, [addresses.data, txs.data]);
}

export function isBlockMinedByWallet(
  block: { height: number; miner_address?: string },
  ctx: { walletAddresses: Set<string>; minedHeights: Set<number> },
): boolean {
  if (ctx.minedHeights.has(block.height)) return true;
  if (
    block.miner_address &&
    ctx.walletAddresses.has(block.miner_address)
  ) {
    return true;
  }
  return false;
}
