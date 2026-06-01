import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { coinQueryKey } from "@/lib/coin/profile";
import { subscribeStakeReward } from "@/hooks/useStakeRewardWatcher";

/** Refresh wallet and explorer queries when a stake reward is detected locally. */
export function useStakeRewardDashboardSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribeStakeReward(() => {
      void queryClient.invalidateQueries({ queryKey: ["explorer-blocks"] });
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey("vericoin", "getblockchaininfo"),
      });
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey("vericoin", "getwalletinfo"),
      });
      void queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === "vericoin" &&
          (q.queryKey[1] === "listtransactions" ||
            q.queryKey[1] === "listaddressgroupings"),
      });
    });
  }, [queryClient]);
}
