import { useEffect } from "react";
import {
  subscribeIncomingVrm,
  type IncomingVrmBatch,
} from "@/hooks/useIncomingVrmWatcher";
import { playReceivedVrmSound } from "@/lib/received-vrm-sound";
import { pushToast } from "@/lib/toast-store";
import { useUserPreferences } from "@/lib/user-preferences";
import { formatNumber } from "@/lib/utils";

function formatBatchMessage(batch: IncomingVrmBatch): {
  title: string;
  description?: string;
} {
  const amount = formatNumber(batch.totalAmount, 4);
  const count = batch.events.length;

  if (count === 1) {
    return {
      title: `Received ${amount} VRM`,
      description: "",
    };
  }

  return {
    title: `Received ${amount} VRM`,
    description: `${count} transactions`,
  };
}

/** Shows toast + plays chime when incoming VRM is detected (if enabled). */
export function useIncomingVrmNotifications(): void {
  const enabled = useUserPreferences(
    (s) => s.prefs.notify_on_vrm_received !== false,
  );

  useEffect(() => {
    if (!enabled) return;

    return subscribeIncomingVrm((batch) => {
      const { title, description } = formatBatchMessage(batch);
      pushToast({
        title,
        description,
        tone: "success",
        durationMs: batch.events.length > 1 ? 8_000 : 6_000,
      });
      void playReceivedVrmSound();
    });
  }, [enabled]);
}
