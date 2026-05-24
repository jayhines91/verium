import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { CoinId } from "@/lib/coin/profile";
import type { BootstrapProgress } from "@/lib/bootstrap-progress";

/** Subscribes to backend bootstrap-progress events for a single coin. */
export function useBootstrapProgress(coin: CoinId, active: boolean) {
  const [progress, setProgress] = useState<BootstrapProgress | null>(null);

  useEffect(() => {
    if (!active) {
      setProgress(null);
      return;
    }

    let cancelled = false;
    const unlistenPromise = listen<BootstrapProgress>(
      "bootstrap-progress",
      (event) => {
        if (cancelled || event.payload.coin !== coin) return;
        setProgress(event.payload);
      },
    );

    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [coin, active]);

  return progress;
}
