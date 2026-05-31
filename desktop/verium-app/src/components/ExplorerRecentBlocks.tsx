import { useEffect, useRef, useState } from "react";

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

import {
  isBlockMinedByWallet,
  useWalletMiningContext,
} from "@/hooks/useWalletMiningContext";

import { subscribeBlockMined } from "@/hooks/useBlockMinedWatcher";

import { BLOCK_AGE_TICK_MS } from "@/lib/block-tip";

import { fetchExplorerBlocks, isExplorerApiEnabled } from "@/lib/explorer-api";
import type { ExplorerBlock } from "@/lib/explorer-api";
import {
  blockRowFromMinedEvent,
  mergeRecentBlocks,
} from "@/lib/local-recent-block";

import { explorerBlocksHash } from "@/lib/explorer-links";

import type { CoinId } from "@/lib/coin/profile";
import { formatCoinAmount } from "@/lib/units";
import { cn, formatBlockAge, formatNumber } from "@/lib/utils";
import { useWindowVisible } from "@/hooks/useWindowVisible";

interface ExplorerRecentBlocksProps {
  coin: import("@/lib/coin/profile").CoinId;
  localTipHeight?: number;

  variant?: "default" | "dashboard";

  className?: string;
}

/** Dashboard live chain feed poll interval. */

const DASHBOARD_BLOCKS_REFETCH_MS = 10_000;

const CELEBRATION_DISMISS_MS = 60_000;

function formatDifficulty(value?: string): string {
  if (!value) return "—";

  const n = Number(value);

  if (!Number.isFinite(n)) return value;

  if (n >= 0.0001) return formatNumber(n, 4);

  return n.toExponential(2);
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

  localTipHeight,

  variant = "default",

  className,
}: ExplorerRecentBlocksProps) {
  const isDashboard = variant === "dashboard";

  const miningCtx = useWalletMiningContext();

  const visible = useWindowVisible();

  const [ageTick, setAgeTick] = useState(0);

  const [celebration, setCelebration] = useState<CelebrationState | null>(null);

  const [localBlocks, setLocalBlocks] = useState<ExplorerBlock[]>([]);

  const dismissTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!isDashboard || !visible) return;

    const id = window.setInterval(
      () => setAgeTick((n) => n + 1),

      BLOCK_AGE_TICK_MS,
    );

    return () => window.clearInterval(id);
  }, [isDashboard, visible]);

  const enabled = useQuery({
    queryKey: ["explorer-api-enabled"],

    queryFn: isExplorerApiEnabled,

    staleTime: Infinity,
  });

  const blocks = useQuery({
    queryKey: ["explorer-blocks", isDashboard ? 10 : 10],

    queryFn: () => fetchExplorerBlocks(coin, isDashboard ? 10 : 10),

    enabled: (isDashboard || enabled.data === true) && visible,

    staleTime: isDashboard ? DASHBOARD_BLOCKS_REFETCH_MS : 0,

    refetchInterval: visible
      ? isDashboard
        ? DASHBOARD_BLOCKS_REFETCH_MS
        : 5_000
      : false,

    refetchOnWindowFocus: !isDashboard,

    retry: isDashboard ? 2 : 0,
  });

  useEffect(() => {
    if (coin !== "verium") return;

    return subscribeBlockMined((event) => {
      setCelebration({
        height: event.height,

        reward:
          event.amount != null && Number.isFinite(event.amount)
            ? formatCoinAmount(event.amount, "verium", 4)
            : "—",
      });

      void blockRowFromMinedEvent("verium", event).then((row) => {
        if (!row) return;
        setLocalBlocks((prev) => {
          const next = prev.filter((b) => b.height !== row.height);
          return [row, ...next].slice(0, 12);
        });
      });
    });
  }, [coin]);

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

  if (!isDashboard && enabled.data !== true) return null;

  const loading = enabled.isLoading || blocks.isLoading;

  const feedLimit = isDashboard ? 10 : 10;
  const blockRows = mergeRecentBlocks(
    blocks.data ?? [],
    coin === "verium" ? localBlocks : [],
    feedLimit,
  );

  const minedInFeed = blockRows.filter((block) =>
    isBlockMinedByWallet(block, miningCtx),
  );

  const minedRewardTotal = minedInFeed.reduce(
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
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-fg">
            Recent blocks
          </CardTitle>

          <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span>
              Latest blocks from the network
              {localTipHeight != null && (
                <>
                  {" "}
                  <span className="tabular-nums">
                    #{formatNumber(localTipHeight)}
                  </span>
                </>
              )}
            </span>

            {!loading && minedInFeed.length > 0 && (
              <MinedBlocksSummary
                count={minedInFeed.length}
                totalRewardVrm={minedRewardTotal}
              />
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
        {celebration && (
          <div className="shrink-0 pt-1">
            <BlockFoundBanner
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
              "isolate overflow-auto",

              isDashboard ? "flex-1" : "max-h-[360px]",
            )}
          >
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-bg-panel text-xs uppercase text-fg-subtle">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Height</th>

                  <th className="px-4 py-2 text-right font-medium  ">
                    Time
                  </th>

                  <th className="px-4 py-2 text-right font-medium ">
                    Txs
                  </th>

                  <th className="px-4 py-2 text-right font-medium ">
                    Out
                  </th>

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
                    const isTip = localTipHeight === block.height;

                    const isYours = isBlockMinedByWallet(block, miningCtx);

                    const isFresh = isYours && isFreshMinedBlock(block.time);

                    const reward = formatBlockOutput(
                      block.output_total ?? block.mint,
                      coin,
                    );

                    return (
                      <tr
                        key={block.hash}
                        className={cn(
                          "border-t border-border transition-colors",

                          youMinedRowClassName({ isYours, isFresh, isTip }),
                        )}
                      >
                        <td className="px-4 py-2 tabular-nums">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={cn(
                                isYours && "font-semibold text-accent",
                              )}
                            >
                              {formatNumber(block.height)}
                            </span>

                            {isYours && <YouMinedBadge fresh={isFresh} />}
                          </div>
                        </td>

                        <td
                          className={cn(
                            "px-4 py-2 text-right text-xs tabular-nums",

                            isYours ? "font-medium text-fg" : "text-fg-muted",
                          )}
                        >
                          {formatBlockAge(block.time, ageTick)}
                        </td>

                        <td className="px-4 py-2 text-right tabular-nums">
                          {block.n_tx ?? "—"}
                        </td>

                        <td
                          className={cn(
                            "px-4 py-2 text-right text-xs tabular-nums",

                            isYours && "font-semibold text-accent",
                          )}
                        >
                          {reward}
                        </td>

                        {isDashboard && (
                          <>
                            <td className="hidden px-4 py-2 text-right text-xs tabular-nums sm:table-cell">
                              {block.size != null
                                ? `${formatNumber(block.size, 0)} B`
                                : "—"}
                            </td>

                            <td className="hidden px-4 py-2 text-right text-xs tabular-nums md:table-cell">
                              {formatDifficulty(block.difficulty)}
                            </td>
                          </>
                        )}

                        <td className="max-w-[160px] truncate px-4 py-2 text-xs">
                          {block.miner_address ? (
                            <ExplorerLink
                              coin={coin}
                              target={{
                                kind: "address",
                                address: block.miner_address,
                              }}
                              label={block.miner_address}
                              className={
                                isYours
                                  ? "font-medium text-accent hover:text-accent"
                                  : undefined
                              }
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
