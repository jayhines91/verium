import type { CoinId } from "@/lib/coin/profile";
import { Pickaxe } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { ExplorerLink } from "@/components/ExplorerLink";
import { MinersPeriodPicker } from "@/components/MinersPeriodPicker";
import type { ExplorerExtractionEntry } from "@/lib/explorer-api";
import { explorerExtractionHash } from "@/lib/explorer-links";
import {
  minersPeriodLabel,
  type MinersPeriodId,
} from "@/lib/miners-periods";

interface NetworkTopMinersCardProps {
  coin: CoinId;
  period: MinersPeriodId;
  onPeriodChange: (period: MinersPeriodId) => void;
  entries?: ExplorerExtractionEntry[];
  isError?: boolean;
  isLoading?: boolean;
}

export function NetworkTopMinersCard({
  coin,
  period,
  onPeriodChange,
  entries = [],
  isError,
  isLoading,
}: NetworkTopMinersCardProps) {
  if (coin !== "verium") return null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <CardTitle className="flex items-center gap-2 normal-case">
              <Pickaxe className="h-4 w-4 text-fg-subtle" aria-hidden />
              Top miners
            </CardTitle>
            <CardDescription>
              Addresses that found the most blocks in{" "}
              {minersPeriodLabel(period).toLowerCase()} (explorer index).
            </CardDescription>
          </div>
          <MinersPeriodPicker
            period={period}
            disabled={isLoading}
            onSelect={onPeriodChange}
          />
        </div>
        <ExplorerLink
          coin={coin}
          target={{
            kind: "raw",
            url: `${explorerExtractionHash(coin)}?period=${period}`,
          }}
          label="Full list"
        />
      </CardHeader>
      <CardContent className="p-0">
        {isError ? (
          <div className="px-5 py-8 text-center text-sm text-fg-muted">
            Could not load extraction data from the explorer.
          </div>
        ) : isLoading && entries.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-fg-muted">
            Loading miner rankings…
          </div>
        ) : entries.length === 0 ? (
          <div className="mx-5 mb-5 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-fg-muted">
            No mining rewards recorded for this period.
          </div>
        ) : (
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-bg-panel text-xs uppercase text-fg-subtle shadow-[0_1px_0_var(--border)]">
                <tr>
                  <th className="px-5 py-2.5 text-left font-medium">Rank</th>
                  <th className="px-5 py-2.5 text-left font-medium">Address</th>
                  <th className="px-5 py-2.5 text-right font-medium">Blocks</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <tr
                    key={entry.address}
                    className="border-t border-border transition-colors hover:bg-bg-subtle/40"
                  >
                    <td className="px-5 py-2.5 tabular-nums text-fg-muted">
                      {entry.rank ?? i + 1}
                    </td>
                    <td className="max-w-[12rem] truncate px-5 py-2.5 text-xs sm:max-w-none">
                      <ExplorerLink
                        target={{ kind: "address", address: entry.address }}
                        label={entry.address}
                      />
                    </td>
                    <td className="px-5 py-2.5 text-right font-semibold tabular-nums">
                      {entry.count ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
