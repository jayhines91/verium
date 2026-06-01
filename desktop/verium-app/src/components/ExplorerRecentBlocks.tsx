import { Blocks, Loader2, Pickaxe, Trophy } from "lucide-react";

import { useEffect, useMemo, useRef, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";

import { ExplorerLink } from "@/components/ExplorerLink";

import {
  BlockFoundBanner,
  isFreshMinedBlock,
  MinedBlocksSummary,
  YouMinedBadge,
  youMinedRowClassName,
} from "@/components/YouMinedCelebration";

import { AnimatedBlockNumber } from "@/components/AnimatedBlockNumber";

import {
  StakeFoundBanner,
  StakedRewardsSummary,
  YouStakedBadge,
  isFreshStakedReward,
  youStakedRowClassName,
} from "@/components/YouStakedCelebration";

import {
  isBlockMinedByWallet,
  useWalletMiningContext,
} from "@/hooks/useWalletMiningContext";

import {
  isBlockStakedByWallet,
  useWalletStakingContext,
} from "@/hooks/useWalletStakingContext";

import { subscribeBlockMined } from "@/hooks/useBlockMinedWatcher";
import { subscribeStakeReward } from "@/hooks/useStakeRewardWatcher";
import { useBlockRowEnterAnimation } from "@/hooks/useBlockRowEnterAnimation";
import { useChainSynced } from "@/hooks/useChainSynced";

import { useBlockAgeTick } from "@/hooks/useBlockAgeTick";
import { useChainSwitchTransition } from "@/hooks/useChainSwitchTransition";
import { useChainTip } from "@/lib/chain-tip-store";

import { fetchExplorerBlocks, isExplorerApiEnabled } from "@/lib/explorer-api";
import type { ExplorerBlock } from "@/lib/explorer-api";
import {
  blockRowFromRewardEvent,
  mergeRecentBlocks,
} from "@/lib/local-recent-block";

import { explorerBlocksHash } from "@/lib/explorer-links";

import { coinQueryKey, type CoinId } from "@/lib/coin/profile";
import { formatCoinAmount } from "@/lib/units";
import { cn, formatBlockAge, formatNumber } from "@/lib/utils";
import { useWindowVisible } from "@/hooks/useWindowVisible";

interface ExplorerRecentBlocksProps {
  coin: import("@/lib/coin/profile").CoinId;

  variant?: "default" | "dashboard";

  className?: string;
}

/**
 * Live updates now arrive instantly from the chain tip watcher; the explorer
 * query is only a safety-net poll plus the source of enrichment (miner address,
 * reward) that the local node row lacks.
 */
const BLOCKS_FALLBACK_REFETCH_MS = 60_000;

const CELEBRATION_DISMISS_MS = 60_000;

function formatDifficulty(value?: string): string {
  if (!value) return "—";

  const n = Number(value);

  if (!Number.isFinite(n)) return value;

  if (n < 0.00001) return n.toExponential(2);

  return formatNumber(n, 7);
}

function formatBlockOutput(value: string | undefined, coin: CoinId): string {
  if (!value) return "—";

  const n = Number(value);

  if (!Number.isFinite(n)) return value;

  return formatCoinAmount(n, coin, 4);
}

function parseBlockOutput(value?: string): number {
  const n = Number(value);

  return Number.isFinite(n) ? n : 0;
}

interface CelebrationState {
  height: number;

  reward: string;
}

export function ExplorerRecentBlocks({
  coin,

  variant = "default",

  className,
}: ExplorerRecentBlocksProps) {
  const isDashboard = variant === "dashboard";

  const isVerium = coin === "verium";

  const miningCtx = useWalletMiningContext(isVerium);
  const stakingCtx = useWalletStakingContext(!isVerium);

  const { synced } = useChainSynced(coin);

  const visible = useWindowVisible();

  const chainTip = useChainTip(coin);
  const { enteringHash, nudgeOthers } = useBlockRowEnterAnimation(
    chainTip.tip?.hash,
  );

  const ageTick = useBlockAgeTick(isDashboard && visible);

  const [celebration, setCelebration] = useState<CelebrationState | null>(null);

  const [localBlocks, setLocalBlocks] = useState<ExplorerBlock[]>([]);

  const dismissTimer = useRef<number | null>(null);

  useEffect(() => {
    setCelebration(null);
    setLocalBlocks([]);
  }, [coin]);

  const enabled = useQuery({
    queryKey: ["explorer-api-enabled"],

    queryFn: isExplorerApiEnabled,

    staleTime: Infinity,
  });

  const blocks = useQuery({
    queryKey: coinQueryKey(coin, "explorer-blocks", 10),

    queryFn: () => fetchExplorerBlocks(coin, 10),

    enabled: (isDashboard || enabled.data === true) && visible,

    staleTime: BLOCKS_FALLBACK_REFETCH_MS,

    refetchInterval: visible ? BLOCKS_FALLBACK_REFETCH_MS : false,

    refetchOnWindowFocus: !isDashboard,

    retry: isDashboard ? 2 : 0,
  });

  useEffect(() => {
    if (coin === "verium") {
      return subscribeBlockMined((event) => {
        setCelebration({
          height: event.height,
          reward:
            event.amount != null && Number.isFinite(event.amount)
              ? formatCoinAmount(event.amount, "verium", 4)
              : "—",
        });

        void blockRowFromRewardEvent("verium", event).then((row) => {
          if (!row) return;
          setLocalBlocks((prev) => {
            const next = prev.filter((b) => b.height !== row.height);
            return [row, ...next].slice(0, 12);
          });
        });
      });
    }

    return subscribeStakeReward((event) => {
      setCelebration({
        height: event.height,
        reward:
          event.amount != null && Number.isFinite(event.amount)
            ? formatCoinAmount(event.amount, "vericoin", 4)
            : "—",
      });

      void blockRowFromRewardEvent("vericoin", event).then((row) => {
        if (!row) return;
        setLocalBlocks((prev) => {
          const next = prev.filter((b) => b.height !== row.height);
          return [row, ...next].slice(0, 12);
        });
      });
    });
  }, [coin]);

  useEffect(() => {
    if (!synced) setCelebration(null);
  }, [synced]);

  useEffect(() => {
    if (!celebration) return;

    if (dismissTimer.current != null) {
      window.clearTimeout(dismissTimer.current);
    }

    dismissTimer.current = window.setTimeout(() => {
      setCelebration(null);

      dismissTimer.current = null;
    }, CELEBRATION_DISMISS_MS);

    return () => {
      if (dismissTimer.current != null) {
        window.clearTimeout(dismissTimer.current);

        dismissTimer.current = null;
      }
    };
  }, [celebration]);

  const loading = enabled.isLoading || blocks.isLoading;
  const switchingChains = useChainSwitchTransition(coin, {
    enabled: isDashboard,
    isReady: !blocks.isLoading && !blocks.isFetching,
  });

  if (!isDashboard && enabled.data !== true) return null;

  const feedLimit = isDashboard ? 10 : 10;
  const liveAndLocal = useMemo(() => {
    return mergeRecentBlocks(chainTip.recentBlocks, localBlocks, 24);
  }, [chainTip.recentBlocks, localBlocks]);
  const blockRows = mergeRecentBlocks(
    blocks.data ?? [],
    liveAndLocal,
    feedLimit,
  );
  /** Instant tip from node watcher; fallback to newest row while watcher warms up. */
  const tipHeight = chainTip.tip?.height ?? blockRows[0]?.height;

  const yoursInFeed = blockRows.filter((block) =>
    isVerium
      ? isBlockMinedByWallet(block, miningCtx)
      : isBlockStakedByWallet(block, stakingCtx),
  );

  const yoursRewardTotal = yoursInFeed.reduce(
    (sum, block) => sum + parseBlockOutput(block.output_total ?? block.mint),
    0,
  );

  return (
    <Card
      className={cn(
        isDashboard && "flex  flex-col",

        className,
      )}
    >
      <CardHeader className="flex-row items-start justify-between shrink-0">
        <div className="space-y-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-fg">
            <Blocks className="h-4 w-4 shrink-0 text-accent" aria-hidden />
            Recent blocks
          </CardTitle>

          <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {!loading && yoursInFeed.length > 0 && isVerium && (
              <MinedBlocksSummary
                count={yoursInFeed.length}
                totalRewardVrm={yoursRewardTotal}
              />
            )}
            {!loading && yoursInFeed.length > 0 && !isVerium && (
              <StakedRewardsSummary count={yoursInFeed.length} />
            )}
          </CardDescription>
        </div>

        <ExplorerLink
          coin={coin}
          target={{ kind: "raw", url: explorerBlocksHash(coin) }}
          label="All blocks"
        />
      </CardHeader>

      <CardContent
        className={cn("p-0", isDashboard && "flex min-h-0 flex-1 flex-col")}
      >
        {celebration && synced && isVerium && (
          <div className="shrink-0 pt-1">
            <BlockFoundBanner
              height={celebration.height}
              reward={celebration.reward}
              onDismiss={() => setCelebration(null)}
            />
          </div>
        )}
        {celebration && synced && !isVerium && (
          <div className="shrink-0 pt-1">
            <StakeFoundBanner
              height={celebration.height}
              reward={celebration.reward}
              onDismiss={() => setCelebration(null)}
            />
          </div>
        )}

        {blocks.isError ? (
          <div className="px-4 py-6 text-xs text-fg-subtle">
            Could not load blocks from explorer.
            {blocks.error != null && (
              <div className="mt-1 text-danger">{String(blocks.error)}</div>
            )}
          </div>
        ) : (
          <div
            className={cn(
              "relative isolate overflow-auto",

              isDashboard ? "flex-1" : "max-h-[360px]",
            )}
          >
            {switchingChains && (
              <div
                className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-bg-panel/85 backdrop-blur-[1px]"
                role="status"
                aria-live="polite"
                aria-busy="true"
                aria-label="Switching chains"
              >
                <Loader2
                  className="h-6 w-6 animate-spin text-accent"
                  aria-hidden
                />
                <span className="text-sm font-medium text-fg">
                  Switching chains
                </span>
              </div>
            )}
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-bg-panel text-xs uppercase text-fg-subtle">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Height</th>

                  <th className="px-4 py-2 text-right font-medium  ">Time</th>

                  <th className="px-4 py-2 text-right font-medium ">Txs</th>

                  <th className="px-4 py-2 text-right font-medium ">Out</th>

                  {isDashboard && (
                    <>
                      <th className="hidden px-4 py-2 text-right font-medium  sm:table-cell">
                        Size
                      </th>

                      <th className="hidden px-4 py-2 text-right font-medium   md:table-cell">
                        Difficulty
                      </th>
                    </>
                  )}

                  <th className="px-4 py-2 text-left font-medium">
                    Extracted by
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading &&
                  Array.from({ length: isDashboard ? 12 : 6 }).map((_, i) => (
                    <tr key={`loading-${i}`} className="border-t border-border">
                      <td colSpan={isDashboard ? 7 : 5} className="px-4 py-2">
                        <div className="h-4 animate-pulse rounded bg-bg-subtle" />
                      </td>
                    </tr>
                  ))}

                {!loading &&
                  blockRows.map((block) => {
                    const isTip = tipHeight === block.height;

                    const isYours = isVerium
                      ? isBlockMinedByWallet(block, miningCtx)
                      : isBlockStakedByWallet(block, stakingCtx);

                    const isFresh = isVerium
                      ? isYours && isFreshMinedBlock(block.time)
                      : isYours && isFreshStakedReward(block.time);

                    const reward = formatBlockOutput(
                      block.output_total ?? block.mint,
                      coin,
                    );

                    const isEntering = enteringHash === block.hash;
                    const isNudging = nudgeOthers && !isEntering;

                    const rowClassName = isVerium
                      ? youMinedRowClassName({ isYours, isFresh, isTip })
                      : youStakedRowClassName({ isYours, isFresh, isTip });

                    return (
                      <tr
                        key={block.hash}
                        className={cn(
                          "border-t border-border transition-[background-color,box-shadow]",
                          rowClassName,
                          isEntering && "block-row-enter",
                          isNudging && "block-row-nudge",
                        )}
                      >
                        <td className="px-4 py-2.5 tabular-nums">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-md px-1.5 py-0.5 tabular-nums",
                                isYours &&
                                  (isVerium
                                    ? "bg-success/12 font-semibold text-success"
                                    : "bg-accent/12 font-semibold text-accent"),
                                !isYours &&
                                  (isTip
                                    ? "font-medium text-accent"
                                    : "text-fg"),
                              )}
                            >
                              <AnimatedBlockNumber
                                value={block.height}
                                forceSpring={isEntering}
                                animateOnIncrease={false}
                              />
                            </span>

                            {isYours &&
                              (isVerium ? (
                                <YouMinedBadge fresh={isFresh} />
                              ) : (
                                <YouStakedBadge fresh={isFresh} />
                              ))}
                          </div>
                        </td>

                        <td
                          className={cn(
                            "px-4 py-2.5 text-right text-xs tabular-nums",
                            isYours ? "font-medium text-fg" : "text-fg-muted",
                          )}
                        >
                          {formatBlockAge(block.time, ageTick)}
                        </td>

                        <td
                          className={cn(
                            "px-4 py-2.5 text-right tabular-nums",
                            isYours ? "text-fg" : "text-fg-muted",
                          )}
                        >
                          {block.n_tx ?? "—"}
                        </td>

                        <td
                          className={cn(
                            "px-4 py-2.5 text-right text-xs tabular-nums",
                            isYours &&
                              (isVerium
                                ? "font-semibold text-success"
                                : "font-semibold text-accent"),
                          )}
                        >
                          {reward}
                        </td>

                        {isDashboard && (
                          <>
                            <td className="hidden px-4 py-2.5 text-right text-xs tabular-nums text-fg-muted sm:table-cell">
                              {block.size != null
                                ? `${formatNumber(block.size, 0)} B`
                                : "—"}
                            </td>

                            <td className="hidden px-4 py-2.5 text-right text-xs tabular-nums text-fg-muted md:table-cell">
                              {formatDifficulty(block.difficulty)}
                            </td>
                          </>
                        )}

                        <td className="max-w-[180px] px-4 py-2.5 text-xs">
                          {isYours ? (
                            block.miner_address ? (
                              <ExplorerLink
                                coin={coin}
                                target={{
                                  kind: "address",
                                  address: block.miner_address,
                                }}
                                label="Your Wallet"
                                className={cn(
                                  "inline-flex max-w-full items-center gap-1.5 truncate font-medium",
                                  isVerium
                                    ? "text-success hover:text-success"
                                    : "text-accent hover:text-accent",
                                )}
                              />
                            ) : (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5 font-medium",
                                  isVerium ? "text-success" : "text-accent",
                                )}
                              >
                                {isVerium ? (
                                  <Pickaxe
                                    className="h-3 w-3 shrink-0 opacity-80"
                                    aria-hidden
                                  />
                                ) : (
                                  <Trophy
                                    className="h-3 w-3 shrink-0 opacity-80"
                                    aria-hidden
                                  />
                                )}
                                You
                              </span>
                            )
                          ) : block.miner_address ? (
                            <ExplorerLink
                              coin={coin}
                              target={{
                                kind: "address",
                                address: block.miner_address,
                              }}
                              label={block.miner_address}
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}

                {!loading && blockRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={isDashboard ? 7 : 5}
                      className="px-4 py-6 text-center text-sm text-fg-subtle"
                    >
                      No blocks returned.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
