import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  SHUTDOWN_PROGRESS_EVENT,
  type ShutdownProgress,
} from "@/lib/shutdown-progress";

/** Subscribes to backend shutdown-progress events during wallet quit. */
export function useShutdownProgress(active = true) {
  const [progress, setProgress] = useState<ShutdownProgress | null>(null);

  useEffect(() => {
    if (!active) {
      setProgress(null);
      return;
    }

    let cancelled = false;
    const unlistenPromise = listen<ShutdownProgress>(
      SHUTDOWN_PROGRESS_EVENT,
      (event) => {
        if (cancelled) return;
        setProgress(event.payload);
      },
    );

    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [active]);

  return progress;
}
