import type { CoinId } from "@/lib/coin/profile";

/** V2 explorer web UI (external links only — API fetches stay on production explorers). */
export const EXPLORER_LINK_BASE = "https://staging-explorer.vericonomy.com";

const LEGACY_EXPLORER_HOSTS = [
  "https://explorer-vrm.vericonomy.com",
  "https://explorer-vrc.vericonomy.com",
];

export function explorerChainPath(coin: CoinId): "vrm" | "vrc" {
  return coin === "verium" ? "vrm" : "vrc";
}

function chainBase(coin: CoinId): string {
  return `${EXPLORER_LINK_BASE}/${explorerChainPath(coin)}`;
}

export function explorerHome(coin: CoinId): string {
  return `${chainBase(coin)}/`;
}

/** Logo asset URL — served from the staging explorer-v2 web app. */
export function explorerLogoUrl(coin: CoinId): string {
  const slug = coin === "verium" ? "verium" : "vericoin";
  return `${EXPLORER_LINK_BASE}/img/vericonomy/${slug}-logo.svg`;
}

export function defaultTxExplorerTemplate(coin: CoinId): string {
  return `${chainBase(coin)}/tx/%s`;
}

export function defaultBlockExplorerTemplate(coin: CoinId): string {
  return `${chainBase(coin)}/block/%s`;
}

export function defaultAddressExplorerTemplate(coin: CoinId): string {
  return `${chainBase(coin)}/address/%s`;
}

export function explorerBlocksHash(coin: CoinId): string {
  return `${chainBase(coin)}/`;
}

export function explorerPeersHash(coin: CoinId): string {
  return `${chainBase(coin)}/`;
}

export function explorerExtractionHash(coin: CoinId): string {
  return coin === "verium"
    ? `${EXPLORER_LINK_BASE}/vrm/miners`
    : `${chainBase(coin)}/`;
}

export function explorerRichlistHash(coin: CoinId): string {
  return `${chainBase(coin)}/richlist`;
}

export function explorerProfitabilityHash(_coin: CoinId): string {
  return `${EXPLORER_LINK_BASE}/insights`;
}

function isLegacyExplorerUrl(url: string): boolean {
  return LEGACY_EXPLORER_HOSTS.some((host) => url.startsWith(host));
}

function otherCoin(coin: CoinId): CoinId {
  return coin === "verium" ? "vericoin" : "verium";
}

function legacyHashTemplate(
  coin: CoinId,
  fragment: "tx" | "block" | "address",
): string {
  const host =
    coin === "verium"
      ? "https://explorer-vrm.vericonomy.com"
      : "https://explorer-vrc.vericonomy.com";
  return `${host}/#${fragment}/%s`;
}

/** True when a saved template targets the other chain (vrm vs vrc path or legacy host). */
export function explorerTemplateTargetsOtherChain(
  coin: CoinId,
  stored: string,
): boolean {
  const lower = stored.toLowerCase();
  const otherPath = explorerChainPath(otherCoin(coin));
  if (lower.includes(`/${otherPath}/`) || lower.includes(`/${otherPath}#`)) {
    return true;
  }
  if (coin === "verium" && lower.includes("explorer-vrc")) return true;
  if (coin === "vericoin" && lower.includes("explorer-vrm")) return true;
  return false;
}

function effectiveExplorerTemplate(
  coin: CoinId,
  stored: string | undefined,
  fragment: "tx" | "block" | "address",
  defaultFor: (c: CoinId) => string,
): string {
  const coinDefault = defaultFor(coin);
  if (!stored) return coinDefault;
  if (isLegacyExplorerUrl(stored)) return coinDefault;
  if (stored === legacyHashTemplate(coin, fragment)) return coinDefault;
  if (stored === legacyHashTemplate(otherCoin(coin), fragment)) return coinDefault;
  if (stored === defaultFor(otherCoin(coin))) return coinDefault;
  if (explorerTemplateTargetsOtherChain(coin, stored)) return coinDefault;
  return stored;
}

/** Prefer the active coin's explorer when prefs still hold a legacy or other-chain default. */
export function effectiveTxExplorerTemplate(
  coin: CoinId,
  stored: string | undefined,
): string {
  return effectiveExplorerTemplate(
    coin,
    stored,
    "tx",
    defaultTxExplorerTemplate,
  );
}

export function effectiveBlockExplorerTemplate(
  coin: CoinId,
  stored: string | undefined,
): string {
  return effectiveExplorerTemplate(
    coin,
    stored,
    "block",
    defaultBlockExplorerTemplate,
  );
}

export function effectiveAddressExplorerTemplate(
  coin: CoinId,
  stored: string | undefined,
): string {
  return effectiveExplorerTemplate(
    coin,
    stored,
    "address",
    defaultAddressExplorerTemplate,
  );
}

export function buildTxExplorerUrl(
  coin: CoinId,
  template: string,
  txid: string,
): string {
  const resolved = effectiveTxExplorerTemplate(coin, template);
  const safe =
    resolved && resolved.includes("%s")
      ? resolved
      : defaultTxExplorerTemplate(coin);
  return safe.replace("%s", encodeURIComponent(txid));
}

export function buildBlockExplorerUrl(
  coin: CoinId,
  template: string,
  blockHashOrHeight: string | number,
): string {
  const resolved = effectiveBlockExplorerTemplate(coin, template);
  const safe =
    resolved && resolved.includes("%s")
      ? resolved
      : defaultBlockExplorerTemplate(coin);
  return safe.replace("%s", encodeURIComponent(String(blockHashOrHeight)));
}

export function buildAddressExplorerUrl(
  coin: CoinId,
  template: string,
  address: string,
): string {
  const resolved = effectiveAddressExplorerTemplate(coin, template);
  const safe =
    resolved && resolved.includes("%s")
      ? resolved
      : defaultAddressExplorerTemplate(coin);
  return safe.replace("%s", encodeURIComponent(address));
}
