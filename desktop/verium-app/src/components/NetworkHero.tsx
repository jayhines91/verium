import type { CoinProfile } from "@/lib/coin/profile";
import { AnimatedBlockNumber } from "@/components/AnimatedBlockNumber";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { ExplorerLink } from "@/components/ExplorerLink";
import { blocksBehindNetwork } from "@/lib/bootstrap-policy";
import { formatNumber } from "@/lib/utils";
import { Activity, Radio } from "lucide-react";

export interface NetworkHeroProps {
  profile: CoinProfile;
  localBlocks?: number;
  headerHeight?: number;
  networkTip?: number;
  peerCount: number;
  networkActive?: boolean;
  chainSynced: boolean;
  ibd?: boolean;
}

export function NetworkHero({
  profile,
  localBlocks,
  headerHeight = 0,
  networkTip,
  peerCount,
  networkActive,
  chainSynced,
  ibd,
}: NetworkHeroProps) {
  const behind = blocksBehindNetwork(localBlocks, networkTip ?? headerHeight);
  const lag = Math.max(0, headerHeight - (localBlocks ?? 0));
  const syncTarget = Math.max(headerHeight, networkTip ?? 0);
  const showSyncBar =
    !chainSynced &&
    syncTarget > (localBlocks ?? 0) &&
    localBlocks != null;
  const syncPct =
    showSyncBar && syncTarget > 0
      ? Math.min(100, ((localBlocks ?? 0) / syncTarget) * 100)
      : 100;

  return (
    <Card className="overflow-hidden border-border/80 bg-gradient-to-br from-bg-panel via-bg-panel to-accent/5">
      <CardContent className="relative p-5 sm:p-6">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-accent/[0.06] blur-3xl"
          aria-hidden
        />

        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Radio className="h-5 w-5 text-accent" aria-hidden />
              <h2 className="text-lg font-semibold text-fg">
                {profile.displayName} network
              </h2>
              <Badge tone={networkActive ? "success" : "neutral"}>
                {networkActive ? "P2P active" : "P2P idle"}
              </Badge>
              {chainSynced ? (
                <Badge tone="success">At chain tip</Badge>
              ) : ibd ? (
                <Badge tone="warning">Syncing (IBD)</Badge>
              ) : (
                <Badge tone="warning">Catching up</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-fg-muted">
              Live node and explorer data for {profile.symbol} — peers, chain
              health, and network economics.
            </p>

            <div className="mt-4">
              <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                Local block height
              </div>
              <div className="mt-1 text-[clamp(1.75rem,4vw,2.75rem)] font-bold tabular-nums tracking-tight text-fg">
                {localBlocks != null ? (
                  <ExplorerLink
                    coin={profile.id}
                    target={{ kind: "block", hashOrHeight: localBlocks }}
                    label={
                      <AnimatedBlockNumber
                        value={localBlocks}
                        className="text-[clamp(1.75rem,4vw,2.75rem)] font-bold"
                      />
                    }
                    showIcon={false}
                    className="text-[clamp(1.75rem,4vw,2.75rem)] font-bold text-fg no-underline hover:text-accent"
                  />
                ) : (
                  "—"
                )}
              </div>
              <p className="mt-1 text-xs text-fg-subtle">
                Headers {headerHeight > 0 ? formatNumber(headerHeight) : "—"}
                {networkTip != null && networkTip > headerHeight && (
                  <> · network tip ~{formatNumber(networkTip)}</>
                )}
                {behind != null && behind > 0 && (
                  <> · ~{formatNumber(behind)} blocks behind tip</>
                )}
              </p>
            </div>

            {showSyncBar && (
              <div className="mt-4 max-w-md">
                <div className="mb-1 flex justify-between text-xs text-fg-muted">
                  <span>Sync progress</span>
                  <span className="tabular-nums">{formatNumber(syncPct, 1)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-bg-panel">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-500"
                    style={{ width: `${syncPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col gap-3 sm:min-w-[10rem]">
            <div className="rounded-lg border border-border/70 bg-bg-subtle/50 px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-fg-muted">
                <Activity className="h-3.5 w-3.5" aria-hidden />
                Peers
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-fg">
                {formatNumber(peerCount)}
              </div>
            </div>
            <div className="rounded-lg border border-border/70 bg-bg-subtle/50 px-4 py-3 text-xs text-fg-subtle">
              Header lag{" "}
              <span className="font-semibold tabular-nums text-fg">
                {headerHeight > 0 ? formatNumber(lag) : "—"}
              </span>{" "}
              blocks
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
