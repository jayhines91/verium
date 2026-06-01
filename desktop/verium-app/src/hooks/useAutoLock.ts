import { useEffect, useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  autoLockGetConfig,
  autoLockRecordActivity,
  autoLockShouldLock,
} from "@/lib/security/client";
import { rpcWalletLock } from "@/lib/rpc/client";
import { useActiveCoin } from "@/lib/coin/context";

const POLL_MS = 30_000;
/** At most one activity ping per interval — avoids a Tauri invoke on every mousemove. */
const ACTIVITY_DEBOUNCE_MS = 60_000;

export function useAutoLock() {
  const coin = useActiveCoin();

  const lock = useMutation({
    mutationFn: async () => {
      await rpcWalletLock(coin);
    },
  });

  const lockMutateRef = useRef(lock.mutate);
  lockMutateRef.current = lock.mutate;

  const lastRecordedRef = useRef(0);

  const recordActivity = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastRecordedRef.current < ACTIVITY_DEBOUNCE_MS) return;
    lastRecordedRef.current = now;
    void autoLockRecordActivity();
  }, []);

  useEffect(() => {
    void autoLockGetConfig();
    recordActivity(true);

    const onActivity = () => recordActivity();
    window.addEventListener("mousemove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity, { passive: true });
    window.addEventListener("click", onActivity, { passive: true });

    const onBlur = async () => {
      const config = await autoLockGetConfig();
      if (!config.enabled || !config.lock_on_blur) return;
      const should = await autoLockShouldLock();
      if (should) lockMutateRef.current();
    };
    const blurHandler = () => void onBlur();
    window.addEventListener("blur", blurHandler);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        void onBlur();
      } else {
        recordActivity(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const interval = window.setInterval(async () => {
      const should = await autoLockShouldLock();
      if (should) lockMutateRef.current();
    }, POLL_MS);

    return () => {
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("click", onActivity);
      window.removeEventListener("blur", blurHandler);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [coin, recordActivity]);

  return { recordActivity };
}
