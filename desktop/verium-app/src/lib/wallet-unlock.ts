import type { WalletInfo } from "@/lib/rpc/client";

/** Max RPC unlock timeout (~3 years). Used for the "Forever" preset. */
export const WALLET_UNLOCK_FOREVER_SECONDS = 100_000_000;

export interface UnlockDurationOption {
  id: string;
  label: string;
  seconds: number;
  warning?: boolean;
}

export const UNLOCK_DURATION_OPTIONS: UnlockDurationOption[] = [
  { id: "15m", label: "15 minutes", seconds: 15 * 60 },
  { id: "1h", label: "1 hour", seconds: 60 * 60 },
  { id: "4h", label: "4 hours", seconds: 4 * 60 * 60 },
  { id: "1d", label: "1 day", seconds: 24 * 60 * 60 },
  {
    id: "forever",
    label: "Forever (not recommended for security)",
    seconds: WALLET_UNLOCK_FOREVER_SECONDS,
    warning: true,
  },
];

export const DEFAULT_WALLET_UNLOCK_SECONDS = 4 * 60 * 60;

export function normalizeUnlockDuration(seconds: number | undefined): number {
  if (!Number.isFinite(seconds) || seconds == null || seconds <= 0) {
    return DEFAULT_WALLET_UNLOCK_SECONDS;
  }
  const match = UNLOCK_DURATION_OPTIONS.find((o) => o.seconds === seconds);
  if (match) return match.seconds;
  return DEFAULT_WALLET_UNLOCK_SECONDS;
}

export function unlockDurationLabel(seconds: number): string {
  const match = UNLOCK_DURATION_OPTIONS.find((o) => o.seconds === seconds);
  return match?.label ?? `${Math.round(seconds / 60)} minutes`;
}

/** True when the wallet is encrypted and currently locked. */
export function isWalletLocked(
  wallet: WalletInfo | null | undefined,
): boolean {
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

export function formatUnlockedUntil(unixSeconds: number): string {
  if (unixSeconds >= WALLET_UNLOCK_FOREVER_SECONDS - 86_400) {
    return "until you lock the wallet or restart the node";
  }
  return `until ${new Date(unixSeconds * 1000).toLocaleString()}`;
}
