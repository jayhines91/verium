import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { useUserPreferences } from "@/lib/user-preferences";
import {
  estimateDailyElectricityCostUsd,
  revenuePeriodLabel,
  scaleDailyValue,
  type DailyMiningEstimate,
  type RevenuePeriod,
} from "@/lib/mining-revenue";
import { formatNumber } from "@/lib/utils";

interface MiningProfitCardProps {
  dailyEstimate: DailyMiningEstimate;
  period: RevenuePeriod;
}

export function MiningProfitCard({
  dailyEstimate,
  period,
}: MiningProfitCardProps) {
  const prefs = useUserPreferences((s) => s.prefs);
  const updatePrefs = useUserPreferences((s) => s.update);

  const dailyCost = estimateDailyElectricityCostUsd(
    prefs.mining_power_watts,
    prefs.mining_cost_per_kwh,
  );
  const periodCost =
    dailyCost != null ? scaleDailyValue(dailyCost, period) : null;
  const periodGrossUsd =
    dailyEstimate.usdPerDay != null
      ? scaleDailyValue(dailyEstimate.usdPerDay, period)
      : null;
  const netUsd =
    periodGrossUsd != null && periodCost != null
      ? periodGrossUsd - periodCost
      : null;

  const periodSuffix = revenuePeriodLabel(period);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Electricity cost</CardTitle>
        <CardDescription>
          Optional — enter power draw and rate to see net USD per {periodSuffix}{" "}
          after electricity.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-sm">
            <label className="text-fg-muted">Power (watts)</label>
            <input
              type="number"
              min={0}
              placeholder="e.g. 65"
              value={prefs.mining_power_watts ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                void updatePrefs({
                  mining_power_watts: v === "" ? undefined : Number(v),
                });
              }}
              className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm tabular-nums outline-none focus:border-accent"
            />
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <label className="text-fg-muted">Cost ($/kWh)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              placeholder="e.g. 0.12"
              value={prefs.mining_cost_per_kwh ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                void updatePrefs({
                  mining_cost_per_kwh: v === "" ? undefined : Number(v),
                });
              }}
              className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm tabular-nums outline-none focus:border-accent"
            />
          </div>
        </div>

        {(periodCost != null || netUsd != null) && (
          <div className="grid grid-cols-2 gap-4 border-t border-border pt-3 text-sm md:grid-cols-3">
            {periodCost != null && (
              <div>
                <div className="text-xs uppercase text-fg-subtle">
                  Cost / {periodSuffix}
                </div>
                <div className="text-lg font-semibold tabular-nums">
                  ${formatNumber(periodCost, 4)}
                </div>
              </div>
            )}
            {netUsd != null && (
              <div>
                <div className="text-xs uppercase text-fg-subtle">
                  Net USD / {periodSuffix}
                </div>
                <div
                  className={`text-lg font-semibold tabular-nums ${
                    netUsd >= 0 ? "text-success" : "text-danger"
                  }`}
                >
                  ${formatNumber(netUsd, 4)}
                </div>
              </div>
            )}
            {periodGrossUsd != null && periodCost != null && (
              <div>
                <div className="text-xs uppercase text-fg-subtle">
                  Gross USD / {periodSuffix}
                </div>
                <div className="text-lg font-semibold tabular-nums">
                  ${formatNumber(periodGrossUsd, 4)}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
