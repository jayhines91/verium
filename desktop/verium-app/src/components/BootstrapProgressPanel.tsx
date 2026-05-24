import { Loader2 } from "lucide-react";
import {
  bootstrapPhaseLabel,
  bootstrapProgressDetail,
  type BootstrapProgress,
} from "@/lib/bootstrap-progress";
import { cn } from "@/lib/utils";

interface BootstrapProgressPanelProps {
  progress: BootstrapProgress | null;
  fallbackMessage?: string;
  className?: string;
}

export function BootstrapProgressPanel({
  progress,
  fallbackMessage = "Preparing bootstrap…",
  className,
}: BootstrapProgressPanelProps) {
  const percent = Math.round(progress?.percent ?? 0);
  const phase = progress?.phase ?? "starting";
  const indeterminate =
    progress != null &&
    progress.phasePercent == null &&
    (progress.phase === "extracting" || progress.phase === "downloading");
  const detail = progress ? bootstrapProgressDetail(progress) : null;
  const message = progress?.message ?? fallbackMessage;

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-bg-subtle p-3 space-y-3",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy={
        progress?.phase !== "done" &&
        progress?.phase !== "error" &&
        progress?.phase !== "cancelled"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {progress?.phase !== "done" && progress?.phase !== "error" && (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
            )}
            <span className="text-xs font-medium text-fg">
              {bootstrapPhaseLabel(phase)}
            </span>
            {!indeterminate && progress && (
              <span className="text-xs tabular-nums text-fg-muted">
                {percent}%
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-fg-muted">{message}</p>
          {detail && (
            <p className="mt-1 font-mono text-[11px] text-fg-subtle">{detail}</p>
          )}
          {progress?.sourceUrl && progress.phase === "downloading" && (
            <p className="mt-1 truncate font-mono text-[10px] text-fg-subtle">
              {progress.sourceUrl}
            </p>
          )}
        </div>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-border/60">
        {indeterminate ? (
          <div className="relative h-full w-full overflow-hidden">
            <div className="bootstrap-indeterminate-bar absolute inset-y-0 w-1/3 rounded-full bg-accent" />
          </div>
        ) : (
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
    </div>
  );
}
