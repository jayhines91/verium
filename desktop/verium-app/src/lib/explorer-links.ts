import type { CoinId } from "@/lib/coin/profile";
import { getCoinProfile } from "@/lib/coin/profile";

function base(coin: CoinId): string {
  return getCoinProfile(coin).explorerBase.replace(/\/$/, "");
}

export function explorerHome(coin: CoinId): string {
  return `${base(coin)}/`;
}

export function explorerLogoUrl(coin: CoinId): string {
  return `${base(coin)}/assets/images/logo.png`;
}

export function defaultTxExplorerTemplate(coin: CoinId): string {
  return `${base(coin)}/#tx/%s`;
}

export function defaultBlockExplorerTemplate(coin: CoinId): string {
  return `${base(coin)}/#block/%s`;
}

export function defaultAddressExplorerTemplate(coin: CoinId): string {
  return `${base(coin)}/#address/%s`;
}

export function explorerBlocksHash(coin: CoinId): string {
  return `${base(coin)}/#homeBlocks`;
}

export function explorerPeersHash(coin: CoinId): string {
  return `${base(coin)}/#homePeers`;
}

export function explorerExtractionHash(coin: CoinId): string {
  return `${base(coin)}/#homeExtraction`;
}

export function explorerRichlistHash(coin: CoinId): string {
  return `${base(coin)}/#homeRichlist`;
}

export function explorerProfitabilityHash(coin: CoinId): string {
  return `${base(coin)}/#homeProfitability`;
}

function otherCoin(coin: CoinId): CoinId {
  return coin === "verium" ? "vericoin" : "verium";
}

/** Prefer the active coin's explorer when prefs still hold the other chain's default. */
export function effectiveTxExplorerTemplate(
  coin: CoinId,
  stored: string | undefined,
): string {
  const coinDefault = defaultTxExplorerTemplate(coin);
  if (!stored) return coinDefault;
  const otherDefault = defaultTxExplorerTemplate(otherCoin(coin));
  if (stored === otherDefault) return coinDefault;
  return stored;
}

export function effectiveBlockExplorerTemplate(
  coin: CoinId,
  stored: string | undefined,
): string {
  const coinDefault = defaultBlockExplorerTemplate(coin);
  if (!stored) return coinDefault;
  const otherDefault = defaultBlockExplorerTemplate(otherCoin(coin));
  if (stored === otherDefault) return coinDefault;
  return stored;
}

export function effectiveAddressExplorerTemplate(
  coin: CoinId,
  stored: string | undefined,
): string {
  const coinDefault = defaultAddressExplorerTemplate(coin);
  if (!stored) return coinDefault;
  const otherDefault = defaultAddressExplorerTemplate(otherCoin(coin));
  if (stored === otherDefault) return coinDefault;
  return stored;
}

export function buildTxExplorerUrl(
  coin: CoinId,
  template: string,
  txid: string,
): string {
  const safe =
    template && template.includes("%s")
      ? template
      : defaultTxExplorerTemplate(coin);
  return safe.replace("%s", encodeURIComponent(txid));
}

export function buildBlockExplorerUrl(
  coin: CoinId,
  template: string,
  blockHashOrHeight: string | number,
): string {
  const safe =
    template && template.includes("%s")
      ? template
      : defaultBlockExplorerTemplate(coin);
  return safe.replace("%s", encodeURIComponent(String(blockHashOrHeight)));
}

export function buildAddressExplorerUrl(
  coin: CoinId,
  template: string,
  address: string,
): string {
  const safe =
    template && template.includes("%s")
      ? template
      : defaultAddressExplorerTemplate(coin);
  return safe.replace("%s", encodeURIComponent(address));
}
