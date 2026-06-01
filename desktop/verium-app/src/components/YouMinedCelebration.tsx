import { Pickaxe, PartyPopper, Trophy, X } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";

/** Blocks mined within this window get extra shimmer in the feed. */
export const FRESH_MINED_BLOCK_SECONDS = 3_600;

export function isFreshMinedBlock(blockTimeSec: number): boolean {
  if (!Number.isFinite(blockTimeSec) || blockTimeSec <= 0) return false;
  return Date.now() / 1000 - blockTimeSec < FRESH_MINED_BLOCK_SECONDS;
}

export function youMinedRowClassName(options: {
  isYours: boolean;
  isFresh?: boolean;
  isTip?: boolean;
}): string {
  const { isYours, isFresh, isTip } = options;
  if (!isYours) {
    return cn(
      "hover:bg-bg-subtle/40",
      isTip ? "bg-accent/8" : "odd:bg-bg-subtle/25",
    );
  }
  return cn(
    "you-mined-row border-l-[3px] border-l-success/70",
    "bg-gradient-to-r from-success/[0.14] via-success/[0.05] to-transparent",
    "hover:from-success/[0.18] hover:via-success/[0.07]",
    isFresh && "you-mined-row-fresh border-l-success",
    isTip && !isFresh && "ring-1 ring-inset ring-success/20",
  );
}

interface YouMinedBadgeProps {
  fresh?: boolean;
  className?: string;
}

export function YouMinedBadge({ fresh, className }: YouMinedBadgeProps) {
  return (
    <span
      className={cn(
        "you-mined-badge inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "border-success/30 bg-success/10 text-[10px] font-semibold uppercase tracking-wide text-success",
        fresh && "you-mined-badge-fresh border-success/45 bg-success/15",
        className,
      )}
    >
      <Pickaxe className="h-3 w-3 shrink-0 opacity-90" aria-hidden />
      You mined
    </span>
  );
}

interface BlockFoundBannerProps {
  height: number;
  reward: string;
  onDismiss: () => void;
}

export function BlockFoundBanner({
  height,
  reward,
  onDismiss,
}: BlockFoundBannerProps) {
  return (
    <div
      className="you-mined-banner relative mx-4 mb-3 overflow-hidden rounded-xl border border-success/35 bg-gradient-to-br from-success/16 via-bg-panel/90 to-bg-subtle/80 px-4 py-3.5 shadow-lg shadow-success/10"
      role="status"
      aria-live="polite"
    >
      <div
        className="you-mined-confetti pointer-events-none absolute inset-0"
        aria-hidden
      />
      <div className="relative flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/15 ring-2 ring-success/25">
          <Trophy className="h-5 w-5 text-success you-mined-trophy-bounce" />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <PartyPopper className="h-4 w-4 text-success" aria-hidden />
            <span className="text-sm font-semibold text-fg">Block found!</span>
          </div>
          <p className="mt-0.5 text-sm text-fg-muted">
            You mined{" "}
            <span className="font-semibold tabular-nums text-success">
              #{formatNumber(height)}
            </span>
            {reward !== "—" && (
              <>
                {" "}
                ·{" "}
                <span className="font-medium text-success/90">{reward}</span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg-panel/80 hover:text-fg"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

interface MinedBlocksSummaryProps {
  count: number;
  totalRewardVrm: number;
}

export function MinedBlocksSummary({ count }: MinedBlocksSummaryProps) {
  if (count <= 0) return null;

  return null;
}
