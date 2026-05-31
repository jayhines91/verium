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
  defaultP2pPort: number;
  earnMode: "mining" | "staking";
  confirmationsMatured: number;
  /** Staging explorer-v2 host (see Rust `explorer_api_base` for the `/v1/:chain/wallet` API path). */
  explorerApiBase: string;
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
    defaultP2pPort: 36988,
    earnMode: "mining",
    confirmationsMatured: 100,
    explorerApiBase: "https://staging-explorer.vericonomy.com",
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
    defaultP2pPort: 58684,
    earnMode: "staking",
    confirmationsMatured: 500,
    explorerApiBase: "https://staging-explorer.vericonomy.com",
    bootstrapCdn: "https://files.vericonomy.com/vrc/bootstrap",
    accentClass: "bg-bg-panel text-fg-muted border-border-strong",
  },
};

export const ALL_COINS: CoinId[] = ["verium", "vericoin"];

export const COIN_LOGO_URLS: Record<CoinId, string> = {
  verium: "/img/vericonomy/verium-logo.svg",
  vericoin: "/img/vericonomy/vericoin-logo.svg",
};

export function getCoinProfile(coin: CoinId): CoinProfile {
  return COIN_PROFILES[coin];
}

export function isValidCoinId(value: string): value is CoinId {
  return value === "verium" || value === "vericoin";
}

export function coinQueryKey(coin: CoinId, ...parts: unknown[]): unknown[] {
  return [coin, ...parts];
}

/** INI section in `vericonomy.conf` for the given coin and network mode. */
export function getNodeConfSection(
  coin: CoinId,
  networkMode: "mainnet" | "binarytest" = "mainnet",
): string {
  if (networkMode === "binarytest") {
    return coin === "verium" ? "binarytest-verium" : "binarytest-vericoin";
  }
  return coin === "verium" ? "verium" : "vericoin";
}
