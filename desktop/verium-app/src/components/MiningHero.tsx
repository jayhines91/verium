import { useEffect, useState } from "react";
import { Cpu, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { MiningPickaxeAnimation } from "@/components/MiningPickaxeAnimation";
import {
  MinerBootBadge,
  MinerHashrateDisplay,
} from "@/components/MinerBootIndicator";
import { formatSessionDuration } from "@/lib/mining-revenue";
import { cn } from "@/lib/utils";

export interface MiningHeroProps {
  active: boolean;
  minerBooting: boolean;
  localHashrate: number;
  hashrateReady: boolean;
  displayThreads: number;
  sessionStartedAt?: number;
  sessionAvg: number | null;
  chainSynced: boolean;
  syncStalled: boolean;
  staticAddressMissing: boolean;
  blocksBehind?: number;
  startPending: boolean;
  stopPending: boolean;
  startError?: Error | null;
  stopError?: Error | null;
  onStart: () => void;
  onStop: () => void;
}

function StartBlockerHint({
  chainSynced,
  syncStalled,
  staticAddressMissing,
  blocksBehind,
}: Pick<
  MiningHeroProps,
  "chainSynced" | "syncStalled" | "staticAddressMissing" | "blocksBehind"
>) {
  if (syncStalled) {
    return <span className="text-danger">Sync is stalled.</span>;
  }
  if (!chainSynced) {
    return (
      <span className="text-warning">
        Wait for the node to reach the network tip
        {blocksBehind != null && blocksBehind > 0
          ? ` (~${blocksBehind.toLocaleString()} blocks behind)`
          : ""}
        .
      </span>
    );
  }
  if (staticAddressMissing) {
    return (
      <span className="text-warning">
        Choose a reward address in Advanced settings (static mode).
      </span>
    );
  }
  return null;
}

export function MiningHero({
  active,
  minerBooting,
  localHashrate,
  hashrateReady,
  displayThreads,
  sessionStartedAt,
  sessionAvg,
  chainSynced,
  syncStalled,
  staticAddressMissing,
  blocksBehind,
  startPending,
  stopPending,
  startError,
  stopError,
  onStart,
  onStop,
}: MiningHeroProps) {
  const [, tick] = useState(0);
  const live = active || minerBooting;
  const mutationError = startError ?? stopError;

  useEffect(() => {
    if (!active || !sessionStartedAt) return;
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [active, sessionStartedAt]);

  const cta = active ? (
    <Button
      variant="danger"
      size="lg"
      onClick={onStop}
      disabled={stopPending}
      className="h-11 shrink-0 px-6 text-base font-semibold shadow-md sm:min-w-[10.5rem]"
    >
      {stopPending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Stopping…
        </>
      ) : (
        "Stop mining"
      )}
    </Button>
  ) : (
    <Button
      size="lg"
      onClick={onStart}
      disabled={
        startPending || !chainSynced || syncStalled || staticAddressMissing
      }
      className="h-11 shrink-0 px-6 text-base font-semibold shadow-md sm:min-w-[10.5rem]"
    >
      {startPending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Starting…
        </>
      ) : (
        "Start mining"
      )}
    </Button>
  );

  return (
    <Card
      className={cn(
        live && "border-accent/25 bg-gradient-to-br from-bg-panel via-bg-panel to-accent/5",
      )}
    >
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <MiningPickaxeAnimation
                active={active && !minerBooting}
                booting={minerBooting}
                size="md"
              />
              <h2 className="text-lg font-semibold text-fg">CPU miner</h2>
              {minerBooting || active ? (
                <MinerBootBadge
                  booting={minerBooting}
                  active={active}
                  activeLabel="Running"
                />
              ) : (
                <Badge tone="neutral">Stopped</Badge>
              )}
            </div>

            {live ? (
              <div className="flex flex-col gap-1">
                <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Live hashrate
                </div>
                <MinerHashrateDisplay
                  booting={minerBooting}
                  value={hashrateReady ? localHashrate : undefined}
                  fractionDigits={2}
                  className="text-[clamp(1.75rem,4vw,2.75rem)] font-bold tracking-tight text-fg"
                  unitClassName="text-lg"
                  spinnerClassName="h-8 w-8"
                />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-bg-subtle/40 px-4 py-5 text-center sm:text-left">
                <p className="text-sm text-fg-muted">
                  Solo CPU mining on this wallet. Configure threads below, then
                  start when your node is synced.
                </p>
                <p className="mt-2 text-xs text-fg-subtle">
                  <StartBlockerHint
                    chainSynced={chainSynced}
                    syncStalled={syncStalled}
                    staticAddressMissing={staticAddressMissing}
                    blocksBehind={blocksBehind}
                  />
                </p>
              </div>
            )}

            {live && sessionStartedAt && (
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <div>
                  <span className="text-fg-subtle">Uptime </span>
                  <span className="font-semibold tabular-nums text-fg">
                    {formatSessionDuration(sessionStartedAt)}
                  </span>
                </div>
                <div>
                  <span className="text-fg-subtle">Threads </span>
                  <span className="font-semibold tabular-nums text-fg">
                    {displayThreads}
                  </span>
                </div>
                {sessionAvg != null && sessionAvg > 0 && !minerBooting && (
                  <div>
                    <span className="text-fg-subtle">Session avg </span>
                    <MinerHashrateDisplay
                      booting={false}
                      value={sessionAvg}
                      fractionDigits={0}
                      className="font-semibold text-fg"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            {cta}
            {!live && (
              <p className="text-center text-xs text-fg-subtle sm:text-right">
                <StartBlockerHint
                  chainSynced={chainSynced}
                  syncStalled={syncStalled}
                  staticAddressMissing={staticAddressMissing}
                  blocksBehind={blocksBehind}
                />
              </p>
            )}
          </div>
        </div>

        {mutationError && (
          <p className="text-xs text-danger">{String(mutationError)}</p>
        )}

        {!live && (
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <Cpu className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Built-in Verium CPU miner — rewards pay to your wallet per reward
            address settings.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
