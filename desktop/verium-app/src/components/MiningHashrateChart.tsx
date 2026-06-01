import { Loader2 } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { ExplorerLink } from "@/components/ExplorerLink";
import { MiningPickaxeAnimation } from "@/components/MiningPickaxeAnimation";
import { EXPLORER_PROFITABILITY } from "@/lib/verium-links";
import { formatNumber } from "@/lib/utils";

export interface HashSample {
  t: number;
  hashrate: number;
}

interface MiningHashrateChartProps {
  samples: HashSample[];
  sessionAvg: number | null;
  sessionStartedAt?: number;
  minerBooting?: boolean;
  active?: boolean;
  emptyWhenIdle?: boolean;
}

export function MiningHashrateChart({
  samples,
  sessionAvg,
  sessionStartedAt,
  minerBooting,
  active,
  emptyWhenIdle,
}: MiningHashrateChartProps) {
  const sessionStartMs =
    sessionStartedAt != null ? sessionStartedAt * 1000 : undefined;
  const showEmpty =
    emptyWhenIdle && !active && !minerBooting && samples.length === 0;
  const showBootingWait =
    minerBooting && samples.length === 0 && !showEmpty;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 normal-case">
            <MiningPickaxeAnimation
              active={active && !minerBooting}
              booting={minerBooting}
              size="sm"
            />
            Local hashrate over time
          </CardTitle>
          <CardDescription>Updated every few seconds while mining.</CardDescription>
        </div>
        <ExplorerLink
          target={{ kind: "raw", url: EXPLORER_PROFITABILITY }}
          label="Profitability calculator"
        />
      </CardHeader>
      <CardContent className="h-64">
        {showEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 text-center text-sm text-fg-muted">
            <MiningPickaxeAnimation size="md" className="opacity-60" />
            <p>Start mining to see hashrate history for this session.</p>
          </div>
        ) : showBootingWait ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-fg-muted">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            Waiting for first hashrate sample…
          </div>
        ) : samples.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-fg-muted">
            No samples yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={samples}>
              <defs>
                <linearGradient id="miningHrFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="t"
                tickFormatter={(t) => new Date(t).toLocaleTimeString()}
                stroke="var(--fg-subtle)"
                fontSize={11}
              />
              <YAxis stroke="var(--fg-subtle)" fontSize={11} />
              <Tooltip
                labelFormatter={(t) =>
                  new Date(t as number).toLocaleTimeString()
                }
                formatter={(value) => {
                  const hr = Number(value);
                  const lines = [`${formatNumber(hr, 2)} H/m`, "Hashrate"];
                  if (
                    sessionAvg != null &&
                    sessionAvg > 0 &&
                    Number.isFinite(hr)
                  ) {
                    const delta = ((hr - sessionAvg) / sessionAvg) * 100;
                    lines.push(
                      `${delta >= 0 ? "+" : ""}${formatNumber(delta, 1)}% vs avg`,
                    );
                  }
                  return lines;
                }}
                contentStyle={{
                  backgroundColor: "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              {sessionStartMs != null && (
                <ReferenceLine
                  x={sessionStartMs}
                  stroke="var(--fg-subtle)"
                  strokeDasharray="3 3"
                  label={{
                    value: "session",
                    position: "insideTopLeft",
                    fontSize: 10,
                    fill: "var(--fg-subtle)",
                  }}
                />
              )}
              {sessionAvg != null && sessionAvg > 0 && (
                <ReferenceLine
                  y={sessionAvg}
                  stroke="var(--fg-subtle)"
                  strokeDasharray="4 4"
                  label={{
                    value: "avg",
                    position: "insideTopRight",
                    fontSize: 10,
                    fill: "var(--fg-subtle)",
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="hashrate"
                stroke="var(--accent)"
                strokeWidth={2}
                fill="url(#miningHrFill)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
