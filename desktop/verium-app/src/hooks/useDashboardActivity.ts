import type { CoinId } from "@/lib/coin/profile";
import { useDashboardData } from "@/hooks/useDashboardData";

/** Shared node + chain activity for dashboard hero and status banner. */
export function useDashboardActivity(coin: CoinId) {
  const data = useDashboardData(coin);
  return {
    ...data.node,
    blockchain: data.blockchain,
    explorer: data.explorer,
    activity: data.activity,
  };
}
