import { useEffect } from "react";
import { DollarSign } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { ExplorerLink } from "@/components/ExplorerLink";
import { RevenuePeriodToggle } from "@/components/RevenuePeriodToggle";
import { EXPLORER_PROFITABILITY } from "@/lib/verium-links";
import {
  clampMiningCostPerKwh,
  clampMiningPowerWatts,
  clampMiningVrmPriceUsd,
  formatMiningUsd,
  MINING_COST_PER_KWH_MAX,
  MINING_POWER_WATTS_MAX,
  MINING_VRM_PRICE_USD_MAX,
  parseOptionalBoundedNumber,
} from "@/lib/mining-input-validation";
import { useUserPreferences } from "@/lib/user-preferences";
import {
  estimateDailyElectricityCostUsd,
  revenuePeriodLabel,
  scaleDailyValue,
  type DailyMiningEstimate,
  type RevenuePeriod,
} from "@/lib/mining-revenue";
import { formatNumber } from "@/lib/utils";

interface MiningEconomicsCardProps {
  dailyEstimate: DailyMiningEstimate;
  period: RevenuePeriod;
  onPeriodChange: (period: RevenuePeriod) => void;
  marketPriceUsd?: number;
  usingCustomVrmPrice: boolean;
  statsSource?: "explorer" | "local";
}

export function MiningEconomicsCard({
  dailyEstimate,
  period,
  onPeriodChange,
  marketPriceUsd,
  usingCustomVrmPrice,
  statsSource,
}: MiningEconomicsCardProps) {
  const prefs = useUserPreferences((s) => s.prefs);
  const updatePrefs = useUserPreferences((s) => s.update);

  useEffect(() => {
    const fixes: Partial<typeof prefs> = {};
    const vrm = clampMiningVrmPriceUsd(prefs.mining_vrm_price_usd);
    if (
      prefs.mining_vrm_price_usd != null &&
      vrm !== prefs.mining_vrm_price_usd
    ) {
      fixes.mining_vrm_price_usd = vrm;
    }
    const watts = clampMiningPowerWatts(prefs.mining_power_watts);
    if (prefs.mining_power_watts != null && watts !== prefs.mining_power_watts) {
      fixes.mining_power_watts = watts;
    }
    const kwh = clampMiningCostPerKwh(prefs.mining_cost_per_kwh);
    if (
      prefs.mining_cost_per_kwh != null &&
      kwh !== prefs.mining_cost_per_kwh
    ) {
      fixes.mining_cost_per_kwh = kwh;
    }
    if (Object.keys(fixes).length > 0) {
      void updatePrefs(fixes);
    }
  }, [
    prefs.mining_vrm_price_usd,
    prefs.mining_power_watts,
    prefs.mining_cost_per_kwh,
    updatePrefs,
  ]);

  const periodSuffix = revenuePeriodLabel(period);
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

  const description = usingCustomVrmPrice
    ? "Using your VRM price assumption for USD estimates."
    : statsSource === "explorer"
      ? "Live network stats from explorer."
      : "Network stats from local node — USD/BTC need explorer prices.";

  return (
    <Card>
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 normal-case">
            <DollarSign className="h-4 w-4" aria-hidden />
            Solo economics
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <RevenuePeriodToggle value={period} onChange={onPeriodChange} />
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1 text-sm sm:col-span-1">
            <label className="text-fg-muted">VRM price ($)</label>
            <input
              type="number"
              min={0}
              max={MINING_VRM_PRICE_USD_MAX}
              step={0.0001}
              placeholder={
                marketPriceUsd != null
                  ? `Live: $${formatNumber(marketPriceUsd, 4)}`
                  : "e.g. 0.07"
              }
              value={prefs.mining_vrm_price_usd ?? ""}
              onChange={(e) => {
                const v = parseOptionalBoundedNumber(
                  e.target.value,
                  MINING_VRM_PRICE_USD_MAX,
                );
                void updatePrefs({ mining_vrm_price_usd: v });
              }}
              className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm tabular-nums outline-none focus:border-accent"
            />
            <p className="text-xs text-fg-subtle">
              Blank = live explorer
              {marketPriceUsd != null
                ? ` ($${formatNumber(marketPriceUsd, 4)})`
                : ""}
              . Max ${MINING_VRM_PRICE_USD_MAX.toLocaleString()}.
            </p>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <label className="text-fg-muted">Power (watts)</label>
            <input
              type="number"
              min={0}
              max={MINING_POWER_WATTS_MAX}
              placeholder="e.g. 65"
              value={prefs.mining_power_watts ?? ""}
              onChange={(e) => {
                const v = parseOptionalBoundedNumber(
                  e.target.value,
                  MINING_POWER_WATTS_MAX,
                );
                void updatePrefs({ mining_power_watts: v });
              }}
              className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm tabular-nums outline-none focus:border-accent"
            />
            <p className="text-xs text-fg-subtle">
              Max {MINING_POWER_WATTS_MAX.toLocaleString()} W.
            </p>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <label className="text-fg-muted">Cost ($/kWh)</label>
            <input
              type="number"
              min={0}
              max={MINING_COST_PER_KWH_MAX}
              step={0.01}
              placeholder="e.g. 0.12"
              value={prefs.mining_cost_per_kwh ?? ""}
              onChange={(e) => {
                const v = parseOptionalBoundedNumber(
                  e.target.value,
                  MINING_COST_PER_KWH_MAX,
                );
                void updatePrefs({ mining_cost_per_kwh: v });
              }}
              className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm tabular-nums outline-none focus:border-accent"
            />
            <p className="text-xs text-fg-subtle">
              Max ${MINING_COST_PER_KWH_MAX}/kWh.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm md:grid-cols-4">
          <div>
            <div className="text-xs uppercase text-fg-subtle">
              VRM / {periodSuffix}
            </div>
            <div className="text-xl font-semibold tabular-nums">
              {formatNumber(
                scaleDailyValue(dailyEstimate.vrmPerDay, period),
                4,
              )}
            </div>
            <div className="mt-0.5 text-xs text-fg-subtle">
              ~
              {formatNumber(
                scaleDailyValue(dailyEstimate.blocksPerDay, period),
                3,
              )}{" "}
              blocks
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-fg-subtle">
              USD / {periodSuffix}
            </div>
            <div className="text-xl font-semibold tabular-nums">
              {dailyEstimate.usdPerDay != null
                ? formatMiningUsd(
                    scaleDailyValue(dailyEstimate.usdPerDay, period),
                  )
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-fg-subtle">
              BTC / {periodSuffix}
            </div>
            <div className="text-xl font-semibold tabular-nums">
              {dailyEstimate.btcPerDay != null
                ? formatNumber(
                    scaleDailyValue(dailyEstimate.btcPerDay, period),
                    8,
                  )
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-fg-subtle">
              Est. block time
            </div>
            <div className="text-xl font-semibold tabular-nums">
              {dailyEstimate.hoursPerBlock != null
                ? `${formatNumber(dailyEstimate.hoursPerBlock, 1)} h`
                : "—"}
            </div>
          </div>
        </div>

        {(periodCost != null || netUsd != null) && (
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-bg-subtle/50 px-4 py-3 text-sm md:grid-cols-3">
            {periodCost != null && (
              <div>
                <div className="text-xs uppercase text-fg-subtle">
                  Electricity / {periodSuffix}
                </div>
                <div className="text-lg font-semibold tabular-nums">
                  {formatMiningUsd(periodCost)}
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
                  {formatMiningUsd(netUsd)}
                </div>
              </div>
            )}
            {periodGrossUsd != null && periodCost != null && (
              <div>
                <div className="text-xs uppercase text-fg-subtle">
                  Gross USD / {periodSuffix}
                </div>
                <div className="text-lg font-semibold tabular-nums">
                  {formatMiningUsd(periodGrossUsd)}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end border-t border-border pt-3">
          <ExplorerLink
            target={{ kind: "raw", url: EXPLORER_PROFITABILITY }}
            label="Open profitability calculator"
          />
        </div>
      </CardContent>
    </Card>
  );
}
