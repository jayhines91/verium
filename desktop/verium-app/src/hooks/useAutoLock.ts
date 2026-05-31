import { useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  autoLockGetConfig,
  autoLockRecordActivity,
  autoLockShouldLock,
} from "@/lib/security/client";
import { rpcWalletLock } from "@/lib/rpc/client";
import { useActiveCoin } from "@/lib/coin/context";

const POLL_MS = 30_000;

export function useAutoLock() {
  const coin = useActiveCoin();

  const lock = useMutation({
    mutationFn: async () => {
      await rpcWalletLock(coin);
    },
  });

  const recordActivity = useCallback(() => {
    void autoLockRecordActivity();
  }, []);

  useEffect(() => {
    void autoLockGetConfig();
    recordActivity();

    const onActivity = () => recordActivity();
    window.addEventListener("mousemove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity, { passive: true });
    window.addEventListener("click", onActivity, { passive: true });

    const onBlur = async () => {
      const config = await autoLockGetConfig();
      if (!config.enabled || !config.lock_on_blur) return;
      const should = await autoLockShouldLock();
      if (should) lock.mutate();
    };
    window.addEventListener("blur", () => void onBlur());

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        void onBlur();
      } else {
        recordActivity();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const interval = window.setInterval(async () => {
      const should = await autoLockShouldLock();
      if (should) lock.mutate();
    }, POLL_MS);

    return () => {
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("click", onActivity);
      window.removeEventListener("blur", () => void onBlur());
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [coin, lock, recordActivity]);

  return { recordActivity };
}
