import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { coinQueryKey } from "@/lib/coin/profile";
import { subscribeBlockMined } from "@/hooks/useBlockMinedWatcher";

/** Refresh wallet and explorer queries as soon as a mined block is detected locally. */
export function useBlockMinedDashboardSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribeBlockMined(() => {
      void queryClient.invalidateQueries({ queryKey: ["explorer-blocks"] });
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey("verium", "getblockchaininfo"),
      });
      void queryClient.invalidateQueries({
        queryKey: coinQueryKey("verium", "getwalletinfo"),
      });
      void queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === "verium" &&
          (q.queryKey[1] === "listtransactions" ||
            q.queryKey[1] === "listaddressgroupings"),
      });
    });
  }, [queryClient]);
}
