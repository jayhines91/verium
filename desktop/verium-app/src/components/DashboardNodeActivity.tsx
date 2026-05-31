import { Loader2 } from "lucide-react";
import { getCoinProfile, type CoinId } from "@/lib/coin/profile";
import { useDashboardActivity } from "@/hooks/useDashboardActivity";
import { showDashboardActivityBanner } from "@/lib/node/dashboard-activity";
import { cn } from "@/lib/utils";

export function DashboardNodeActivity({ coin }: { coin: CoinId }) {
  const profile = getCoinProfile(coin);
  const { activity } = useDashboardActivity(coin);

  if (!showDashboardActivityBanner(activity)) {
    return null;
  }

  const progress =
    activity.progress != null &&
    activity.progress > 0 &&
    activity.progress < 1
      ? activity.progress
      : undefined;

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        activity.kind === "unavailable"
          ? "border-danger/30 bg-danger/10"
          : "border-accent/25 bg-accent/5",
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        {activity.showSpinner && (
          <Loader2
            className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-accent"
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium text-fg">{activity.title}</div>
          {activity.detail && (
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">
              {activity.detail}
            </p>
          )}
          {progress != null && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                <span>Progress</span>
                <span className="tabular-nums">{Math.round(progress * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-subtle">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}
          <p className="mt-2 text-[10px] text-fg-subtle">
            {profile.symbol} node · this updates automatically
          </p>
        </div>
      </div>
    </div>
  );
}
