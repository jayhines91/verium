import { PartyPopper, Trophy, X } from "lucide-react";
import { EXPLORER_LOGO_URL } from "@/lib/verium-links";
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
    return isTip ? "bg-accent/10" : "odd:bg-bg-subtle/30";
  }
  return cn(
    "relative you-mined-row border-l-[3px] border-l-accent",
    "bg-gradient-to-r from-accent/14 via-bg-panel/40 to-transparent",
    isFresh && "you-mined-row-fresh",
    isTip && "ring-1 ring-inset ring-accent/20",
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
        "border-accent/40 bg-gradient-to-r from-accent/20 via-bg-panel/80 to-accent/10",
        "text-[10px] font-bold uppercase tracking-wider text-accent shadow-sm",
        fresh && "you-mined-badge-fresh",
        className,
      )}
    >
      <img
        src={EXPLORER_LOGO_URL}
        alt=""
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 rounded-sm object-contain"
      />
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
      className="you-mined-banner relative mx-4 mb-3 overflow-hidden rounded-xl border border-accent/35 bg-gradient-to-br from-accent/18 via-bg-panel/90 to-bg-subtle/80 px-4 py-3.5 shadow-lg shadow-accent/10"
      role="status"
      aria-live="polite"
    >
      <div className="you-mined-confetti pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 ring-2 ring-accent/25">
          <Trophy className="h-5 w-5 text-accent you-mined-trophy-bounce" />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <PartyPopper className="h-4 w-4 text-accent" aria-hidden />
            <span className="text-sm font-semibold text-fg">Block found!</span>
          </div>
          <p className="mt-0.5 text-sm text-fg-muted">
            You mined{" "}
            <span className="font-semibold tabular-nums text-accent">
              #{formatNumber(height)}
            </span>
            {reward !== "—" && (
              <>
                {" "}
                · <span className="font-medium text-fg">{reward}</span>
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

export function MinedBlocksSummary({
  count,
  totalRewardVrm,
}: MinedBlocksSummaryProps) {
  if (count <= 0) return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
      <Trophy className="h-3 w-3" aria-hidden />
      {count} block{count === 1 ? "" : "s"} you mined
      {totalRewardVrm > 0 && (
        <span className="text-fg-muted">
          · {formatNumber(totalRewardVrm, 4)} VRM
        </span>
      )}
    </span>
  );
}

