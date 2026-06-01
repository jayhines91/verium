import { useState } from "react";
import {
  ADAPTIVE_MINING_POLL_MS,
  clampMiningThreads,
  detectedLogicalCpus,
  MINING_THREADS_MIN,
  triedToMineOnAllLogicalCpus,
  type CpuTopology,
} from "@/lib/mining-opt";
import { OkDialog } from "@/components/OkDialog";

interface MiningThreadControlsProps {
  autoAdjust: boolean;
  manualThreads: number;
  /** Device-tuned max threads when auto-adjust is on. */
  suggestedThreads?: number;
  /** Allowed max threads (detected logical CPUs − 1). */
  maxThreads: number;
  topology?: CpuTopology;
  logicalCpus?: number;
  /** Active miner thread count (when mining with auto-adjust). */
  activeThreads?: number;
  isMining?: boolean;
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
  topology,
  logicalCpus,
  activeThreads,
  isMining = false,
  disabled = false,
  compact = false,
  onAutoAdjustChange,
  onManualThreadsChange,
}: MiningThreadControlsProps) {
  const [allCpusWarningOpen, setAllCpusWarningOpen] = useState(false);
  const detected =
    logicalCpus ?? detectedLogicalCpus(topology);
  const allowedMax = maxThreads;
  const deviceCeiling = Math.min(
    suggestedThreads ?? manualThreads,
    allowedMax,
  );
  const effectiveThreads = autoAdjust
    ? isMining && activeThreads != null && activeThreads > 0
      ? activeThreads
      : deviceCeiling
    : clampMiningThreads(manualThreads, allowedMax);

  const cpuHint =
    detected > 0
      ? `${detected} logical CPU${detected === 1 ? "" : "s"} detected`
      : null;

  const handleManualThreadsChange = (raw: number) => {
    if (triedToMineOnAllLogicalCpus(raw, topology, detected)) {
      setAllCpusWarningOpen(true);
      onManualThreadsChange(allowedMax);
      return;
    }
    onManualThreadsChange(
      clampMiningThreads(raw || MINING_THREADS_MIN, allowedMax),
    );
  };

  return (
    <>
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
                (max{" "}
                <span className="tabular-nums">{allowedMax}</span> of{" "}
                <span className="tabular-nums">{detected}</span> detected — one
                CPU reserved for the system)
              </>
            ) : (
              " based on CPU topology"
            )}
            {suggestedThreads == null ? (
              " (detecting…)"
            ) : null}
            {isMining ? (
              <>
                {" "}
                · adjusts every {ADAPTIVE_MINING_POLL_MS / 1000}s from CPU load
              </>
            ) : null}
          </p>
        ) : (
          <div
            className={`flex flex-col gap-1 ${compact ? "text-xs" : "text-sm"}`}
          >
            <label className="text-fg-muted">Threads</label>
            <input
              type="number"
              min={MINING_THREADS_MIN}
              max={detected}
              value={effectiveThreads}
              disabled={disabled}
              onChange={(e) =>
                handleManualThreadsChange(
                  Number(e.target.value) || MINING_THREADS_MIN,
                )
              }
              className="h-9 max-w-[8rem] rounded-md border border-border bg-bg px-3 tabular-nums outline-none focus:border-accent disabled:opacity-50"
            />
            <p className="text-xs text-fg-subtle">
              Set between {MINING_THREADS_MIN} and {allowedMax}
              {cpuHint ? ` (${cpuHint})` : ""}. The UI shows up to {detected}{" "}
              CPUs, but mining is capped at {allowedMax} so one core stays free.
              Stop the miner before changing threads.
            </p>
          </div>
        )}

        {disabled && !autoAdjust && (
          <p className="text-xs text-fg-subtle">
            Stop mining to change thread settings.
          </p>
        )}
      </div>

      <OkDialog
        open={allCpusWarningOpen}
        title="Cannot mine on all CPUs"
        message={`Mining on all ${detected} logical CPUs can make your system unresponsive. Verium limits mining to ${allowedMax} thread${allowedMax === 1 ? "" : "s"} so one CPU remains available for the wallet and operating system.`}
        onOk={() => setAllCpusWarningOpen(false)}
      />
    </>
  );
}
