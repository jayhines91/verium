import type { CoinId } from "@/lib/coin/profile";
import type { UserPreferences } from "@/lib/user-preferences";

/** True when the user finished (or migrated) first-run setup for this chain. */
export function isCoinSetupComplete(
  coin: CoinId,
  prefs: Pick<UserPreferences, "setup_completed" | "setup_completed_by_coin">,
): boolean {
  const perCoin = prefs.setup_completed_by_coin?.[coin];
  if (perCoin === true) return true;
  if (perCoin === false) return false;
  // Legacy single flag: only treat Verium as done (pre–dual-chain installs).
  if (prefs.setup_completed && coin === "verium") return true;
  return false;
}

/** Merge partial prefs to mark one chain's setup wizard finished. */
export function coinSetupCompletePatch(
  coin: CoinId,
  prefs: UserPreferences,
): Partial<UserPreferences> {
  return {
    setup_completed_by_coin: {
      ...prefs.setup_completed_by_coin,
      [coin]: true,
    },
    setup_completed: prefs.setup_completed || coin === "verium",
  };
}
