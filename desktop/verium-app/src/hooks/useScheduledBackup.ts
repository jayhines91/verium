import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEnabledCoins } from "@/lib/coin/context";
import { backupRunScheduled } from "@/lib/security/client";

/** How often the app checks whether a scheduled backup is due. */
export const BACKUP_SCHEDULER_TICK_MS = 60_000;

/** Poll interval for backup health stats shown in the UI. */
export const BACKUP_HEALTH_REFETCH_MS = 30_000;

/**
 * Runs wallet.dat backups on the configured hourly/daily/weekly schedule while
 * the app is open and refreshes backup health when a run completes.
 */
export function useScheduledBackup() {
  const queryClient = useQueryClient();
  const enabledCoins = useEnabledCoins();
  const runningRef = useRef(false);
  const coinsKey = enabledCoins.join(",");

  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      if (runningRef.current || enabledCoins.length === 0) return;

      runningRef.current = true;
      try {
        const result = await backupRunScheduled(enabledCoins);
        if (result.ran) {
          await queryClient.invalidateQueries({ queryKey: ["backup-health"] });
        }
      } catch (err) {
        console.warn("scheduled backup tick failed:", err);
      } finally {
        runningRef.current = false;
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), BACKUP_SCHEDULER_TICK_MS);
    return () => window.clearInterval(id);
  }, [coinsKey, enabledCoins, queryClient]);
}
