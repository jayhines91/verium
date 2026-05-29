export type CoinId = "verium" | "vericoin";

export interface CoinProfile {
  id: CoinId;
  symbol: "VRM" | "VRC";
  displayName: string;
  tagline: string;
  binaryName: string;
  confFilename: string;
  chainArg?: string;
  defaultRpcPort: number;
  earnMode: "mining" | "staking";
  confirmationsMatured: number;
  explorerBase: string;
  bootstrapCdn: string;
  accentClass: string;
}

export const COIN_PROFILES: Record<CoinId, CoinProfile> = {
  verium: {
    id: "verium",
    symbol: "VRM",
    displayName: "Verium",
    tagline: "Reserve",
    binaryName: "veriumd",
    confFilename: "vericonomy.conf",
    defaultRpcPort: 33987,
    earnMode: "mining",
    confirmationsMatured: 100,
    explorerBase: "https://explorer-vrm.vericonomy.com",
    bootstrapCdn: "https://files.vericonomy.com/vrm/bootstrap",
    accentClass: "bg-accent/15 text-accent border-accent/30",
  },
  vericoin: {
    id: "vericoin",
    symbol: "VRC",
    displayName: "Vericoin",
    tagline: "Currency",
    binaryName: "vericoind",
    confFilename: "vericonomy.conf",
    chainArg: "-chain=vericoin",
    defaultRpcPort: 58683,
    earnMode: "staking",
    confirmationsMatured: 500,
    explorerBase: "https://explorer-vrc.vericonomy.com",
    bootstrapCdn: "https://files.vericonomy.com/vrc/bootstrap",
    accentClass: "bg-bg-panel text-fg-muted border-border-strong",
  },
};

export const ALL_COINS: CoinId[] = ["verium", "vericoin"];

export function getCoinProfile(coin: CoinId): CoinProfile {
  return COIN_PROFILES[coin];
}

export function isValidCoinId(value: string): value is CoinId {
  return value === "verium" || value === "vericoin";
}

export function coinQueryKey(coin: CoinId, ...parts: unknown[]): unknown[] {
  return [coin, ...parts];
}
