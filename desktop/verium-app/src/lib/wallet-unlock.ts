import type { CoinId } from "@/lib/coin/profile";
import type { WalletInfo } from "@/lib/rpc/client";

/** Standard walletpassphrase timeout (4 hours). */
export const DEFAULT_WALLET_UNLOCK_SECONDS = 4 * 60 * 60;

const WALLET_UNLOCK_FOREVER_SECONDS = 100_000_000;

/** Seconds passed to walletpassphrase on unlock. */
export function rpcUnlockTimeoutSeconds(): number {
  return DEFAULT_WALLET_UNLOCK_SECONDS;
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

export function formatUnlockedUntil(unixSeconds: number): string {
  if (unixSeconds >= WALLET_UNLOCK_FOREVER_SECONDS - 86_400) {
    return "until you lock the wallet or restart the node";
  }
  return `until ${new Date(unixSeconds * 1000).toLocaleString()}`;
}
