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

export function walletSetupModeLabel(mode: WalletSetupMode): string {
  switch (mode) {
    case "loading":
      return "Checking wallet status…";
    case "offline":
      return "Connect to veriumd on the previous step before setting up your wallet.";
    case "needs_encrypt":
      return "Set a passphrase to encrypt your wallet. Your coins stay in the same wallet.dat file.";
    case "needs_unlock":
      return "An existing Verium wallet was found. Enter the same passphrase you used before to unlock it — your balance and history are preserved.";
    case "ready":
      return "Wallet is unlocked and ready.";
  }
}
