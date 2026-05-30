import type { CoinId } from "@/lib/coin/profile";
import { COIN_PROFILES } from "@/lib/coin/profile";
import type { WalletInfo } from "@/lib/rpc/client";
import {
  isWalletEncrypted,
  isWalletLocked,
} from "@/lib/wallet-unlock";

export type WalletSetupMode =
  | "loading"
  | "offline"
  | "needs_encrypt"
  | "needs_unlock"
  | "ready";

export function resolveWalletSetupMode(
  _coin: CoinId,
  connected: boolean,
  walletLoading: boolean,
  wallet: WalletInfo | null | undefined,
  fileExists: boolean | undefined,
): WalletSetupMode {
  if (!connected) return "offline";
  if (walletLoading) return "loading";

  if (wallet) {
    if (isWalletEncrypted(wallet)) {
      return isWalletLocked(wallet) ? "needs_unlock" : "ready";
    }
    return "needs_encrypt";
  }

  if (fileExists) return "needs_unlock";
  return "needs_encrypt";
}

export function walletSetupModeLabel(
  coin: CoinId,
  mode: WalletSetupMode,
): string {
  const name = COIN_PROFILES[coin].displayName;
  const daemon = COIN_PROFILES[coin].binaryName;
  switch (mode) {
    case "loading":
      return "Checking wallet status…";
    case "offline":
      return `Connect to ${daemon} on the previous step before setting up your wallet.`;
    case "needs_encrypt":
      return `Set a passphrase to encrypt your ${name} wallet. Your coins stay in the same wallet.dat file.`;
    case "needs_unlock":
      return `An existing ${name} wallet was found. Enter the passphrase you used before to unlock it — your balance and history are preserved.`;
    case "ready":
      return "Wallet is unlocked and ready.";
  }
}
