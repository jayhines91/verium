import type { UserPreferences } from "@/lib/user-preferences";

export type MiningRewardAddressMode = "dynamic" | "static";

export function isStaticMiningRewardMode(
  prefs: Pick<UserPreferences, "mining_reward_address_mode">,
): boolean {
  return prefs.mining_reward_address_mode === "static";
}

/** Address to pass to minerstart when static mode is enabled; undefined for dynamic. */
export function miningRewardAddressForStart(
  prefs: Pick<UserPreferences, "mining_reward_address_mode" | "mining_reward_address">,
): string | undefined {
  if (!isStaticMiningRewardMode(prefs)) return undefined;
  const addr = prefs.mining_reward_address?.trim();
  return addr || undefined;
}

export function staticMiningAddressConfigured(
  prefs: Pick<UserPreferences, "mining_reward_address_mode" | "mining_reward_address">,
): boolean {
  return isStaticMiningRewardMode(prefs) && Boolean(prefs.mining_reward_address?.trim());
}
