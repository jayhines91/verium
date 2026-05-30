import { Loader2 } from "lucide-react";
import { useShutdownProgress } from "@/hooks/useShutdownProgress";
import { SHUTDOWN_FALLBACK_MESSAGE } from "@/lib/shutdown-progress";
import { ShutdownProgressPanel } from "./ShutdownProgressPanel";

export function ShutdownProgressOverlay() {
  const progress = useShutdownProgress();

  if (!progress) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-panel p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" />
          <h4 className="text-lg font-semibold">Quitting wallet</h4>
        </div>
        <ShutdownProgressPanel
          progress={progress}
          fallbackMessage={SHUTDOWN_FALLBACK_MESSAGE}
        />
      </div>
    </div>
  );
}
