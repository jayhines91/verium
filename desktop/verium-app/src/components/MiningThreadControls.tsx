import {
  clampMiningThreads,
  MINING_THREADS_MIN,
} from "@/lib/mining-opt";

interface MiningThreadControlsProps {
  autoAdjust: boolean;
  manualThreads: number;
  suggestedThreads?: number;
  maxThreads: number;
  logicalCpus?: number;
  disabled?: boolean;
  compact?: boolean;
  onAutoAdjustChange: (autoAdjust: boolean) => void;
  onManualThreadsChange: (threads: number) => void;
}

export function MiningThreadControls({
  autoAdjust,
  manualThreads,
  suggestedThreads,
  maxThreads,
  logicalCpus,
  disabled = false,
  compact = false,
  onAutoAdjustChange,
  onManualThreadsChange,
}: MiningThreadControlsProps) {
  const effectiveThreads = autoAdjust
    ? suggestedThreads ?? manualThreads
    : clampMiningThreads(manualThreads, maxThreads);

  const cpuHint =
    logicalCpus != null && logicalCpus > 0
      ? `${logicalCpus} logical CPU${logicalCpus === 1 ? "" : "s"} detected`
      : null;

  return (
    <div
      className={
        compact
          ? "flex flex-col gap-2"
          : "flex flex-col gap-3 rounded-lg border border-border bg-bg-subtle px-3 py-3"
      }
    >
      <label
        className={`flex cursor-pointer items-center gap-2 ${compact ? "text-xs text-fg-muted" : "text-sm"}`}
      >
        <input
          type="checkbox"
          checked={autoAdjust}
          disabled={disabled}
          onChange={(e) => onAutoAdjustChange(e.target.checked)}
          className="h-3.5 w-3.5 rounded accent-accent disabled:opacity-50"
        />
        <span>Auto-adjust threads for this device</span>
      </label>

      {autoAdjust ? (
        <p className={`${compact ? "text-xs" : "text-sm"} text-fg-subtle`}>
          Using{" "}
          <span className="font-medium tabular-nums text-fg">
            {effectiveThreads}
          </span>{" "}
          thread{effectiveThreads === 1 ? "" : "s"}
          {cpuHint ? (
            <>
              {" "}
              of <span className="tabular-nums">{logicalCpus}</span> available
            </>
          ) : (
            " based on CPU topology"
          )}
          {suggestedThreads == null ? " (detecting…)" : "."}
        </p>
      ) : (
        <div className={`flex flex-col gap-1 ${compact ? "text-xs" : "text-sm"}`}>
          <label className="text-fg-muted">Threads</label>
          <input
            type="number"
            min={MINING_THREADS_MIN}
            max={maxThreads}
            value={effectiveThreads}
            disabled={disabled}
            onChange={(e) =>
              onManualThreadsChange(
                clampMiningThreads(
                  Number(e.target.value) || MINING_THREADS_MIN,
                  maxThreads,
                ),
              )
            }
            className="h-9 max-w-[8rem] rounded-md border border-border bg-bg px-3 tabular-nums outline-none focus:border-accent disabled:opacity-50"
          />
          <p className="text-xs text-fg-subtle">
            Set between {MINING_THREADS_MIN} and {maxThreads}
            {cpuHint ? ` (${cpuHint})` : ""}. Stop the miner before changing
            threads.
          </p>
        </div>
      )}

      {disabled && (
        <p className="text-xs text-fg-subtle">
          Stop mining to change thread settings.
        </p>
      )}
    </div>
  );
}
