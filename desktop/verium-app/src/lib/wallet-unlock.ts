import type { CoinId } from "@/lib/coin/profile";
import type { WalletInfo } from "@/lib/rpc/client";
import type { UserPreferences } from "@/lib/user-preferences";

/** Pref sentinel: re-lock quickly and never auto-unlock on app reopen. */
export const WALLET_UNLOCK_NEVER_SECONDS = 0;

/** Max RPC unlock timeout (~3 years). Used for the "Forever" preset. */
export const WALLET_UNLOCK_FOREVER_SECONDS = 100_000_000;

/** RPC timeout when "Never" is selected — long enough to mine/stake, short enough to re-lock. */
export const WALLET_UNLOCK_NEVER_RPC_SECONDS = 60;

export interface UnlockDurationOption {
  id: string;
  label: string;
  seconds: number;
  warning?: boolean;
}

export const UNLOCK_DURATION_OPTIONS: UnlockDurationOption[] = [
  {
    id: "never",
    label: "Never - ask for passphrase every time",
    seconds: WALLET_UNLOCK_NEVER_SECONDS,
  },
  { id: "15m", label: "15 minutes", seconds: 15 * 60 },
  { id: "1h", label: "1 hour", seconds: 60 * 60 },
  { id: "4h", label: "4 hours", seconds: 4 * 60 * 60 },
  { id: "1d", label: "1 day", seconds: 24 * 60 * 60 },
  {
    id: "forever",
    label: "Forever (continuous mining/staking)",
    seconds: WALLET_UNLOCK_FOREVER_SECONDS,
    warning: true,
  },
];

export const DEFAULT_WALLET_UNLOCK_SECONDS = 4 * 60 * 60;

export function normalizeUnlockDuration(seconds: number | undefined): number {
  if (seconds === WALLET_UNLOCK_NEVER_SECONDS) {
    return WALLET_UNLOCK_NEVER_SECONDS;
  }
  if (!Number.isFinite(seconds) || seconds == null || seconds < 0) {
    return DEFAULT_WALLET_UNLOCK_SECONDS;
  }
  if (seconds >= WALLET_UNLOCK_FOREVER_SECONDS - 86_400) {
    return WALLET_UNLOCK_FOREVER_SECONDS;
  }
  const match = UNLOCK_DURATION_OPTIONS.find((o) => o.seconds === seconds);
  if (match) return match.seconds;
  return DEFAULT_WALLET_UNLOCK_SECONDS;
}

export function unlockDurationForCoin(
  prefs: UserPreferences,
  coin: CoinId,
): number {
  const byCoin = prefs.wallet_unlock_duration_by_coin?.[coin];
  if (byCoin !== undefined) return normalizeUnlockDuration(byCoin);
  return normalizeUnlockDuration(prefs.wallet_unlock_duration_seconds);
}

/** Seconds passed to walletpassphrase for the current preference. */
export function rpcUnlockTimeoutSeconds(prefSeconds: number): number {
  if (prefSeconds === WALLET_UNLOCK_NEVER_SECONDS) {
    return WALLET_UNLOCK_NEVER_RPC_SECONDS;
  }
  return normalizeUnlockDuration(prefSeconds);
}

export function isNeverUnlockDuration(seconds: number | undefined): boolean {
  return normalizeUnlockDuration(seconds) === WALLET_UNLOCK_NEVER_SECONDS;
}

export function isForeverUnlockDuration(seconds: number | undefined): boolean {
  return normalizeUnlockDuration(seconds) === WALLET_UNLOCK_FOREVER_SECONDS;
}

export function unlockDurationLabel(seconds: number): string {
  const match = UNLOCK_DURATION_OPTIONS.find((o) => o.seconds === seconds);
  return match?.label ?? `${Math.round(seconds / 60)} minutes`;
}

/** True when the wallet is encrypted and currently locked. */
export function isWalletLocked(wallet: WalletInfo | null | undefined): boolean {
  if (!wallet) return false;
  const until = wallet.unlocked_until;
  if (until === undefined || until === null) return false;
  if (until === 0) return true;
  return until * 1000 <= Date.now();
}

/** True when the wallet can sign (unencrypted or unlocked). */
export function isWalletUnlocked(
  wallet: WalletInfo | null | undefined,
): boolean {
  if (!wallet) return false;
  return !isWalletLocked(wallet);
}

/** True when the wallet uses encryption (passphrase required to sign). */
export function isWalletEncrypted(
  wallet: WalletInfo | null | undefined,
): boolean {
  if (!wallet) return false;
  const until = wallet.unlocked_until;
  if (until === undefined || until === null) return false;
  return true;
}

/** Vericoin stake-only unlock when wallet supports minting-only mode. */
export function shouldUnlockMintingOnly(
  coin: CoinId,
  mintingOnly?: boolean,
): boolean {
  return coin === "vericoin" && mintingOnly === true;
}

export function patchUnlockDurationPrefs(
  prefs: UserPreferences,
  coin: CoinId,
  seconds: number,
): Pick<UserPreferences, "wallet_unlock_duration_seconds" | "wallet_unlock_duration_by_coin"> {
  return {
    wallet_unlock_duration_seconds: seconds,
    wallet_unlock_duration_by_coin: {
      ...prefs.wallet_unlock_duration_by_coin,
      [coin]: seconds,
    },
  };
}

export function formatUnlockedUntil(unixSeconds: number): string {
  if (unixSeconds >= WALLET_UNLOCK_FOREVER_SECONDS - 86_400) {
    return "until you lock the wallet or restart the app";
  }
  return `until ${new Date(unixSeconds * 1000).toLocaleString()}`;
}
