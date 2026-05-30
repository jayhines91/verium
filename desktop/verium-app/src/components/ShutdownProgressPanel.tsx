import { Loader2 } from "lucide-react";
import {
  SHUTDOWN_FALLBACK_MESSAGE,
  type ShutdownProgress,
} from "@/lib/shutdown-progress";
import { cn } from "@/lib/utils";

interface ShutdownProgressPanelProps {
  progress: ShutdownProgress | null;
  fallbackMessage?: string;
  className?: string;
}

export function ShutdownProgressPanel({
  progress,
  fallbackMessage = SHUTDOWN_FALLBACK_MESSAGE,
  className,
}: ShutdownProgressPanelProps) {
  const percent = Math.round(progress?.percent ?? 0);
  const message = progress?.message ?? fallbackMessage;

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-bg-subtle p-3 space-y-3",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy
    >
      <div className="flex items-start gap-2">
        <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{message}</p>
          {progress && (
            <p className="mt-1 text-xs tabular-nums text-fg-muted">{percent}%</p>
          )}
        </div>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-border/60">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
