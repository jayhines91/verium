/**
 * Central source of truth for Vericonomy public resources.
 *
 * Coin-specific explorer URLs live in `explorer-links.ts`. Constants below
 * default to Verium for backward compatibility with legacy imports.
 */

import {
  defaultAddressExplorerTemplate,
  defaultBlockExplorerTemplate,
  defaultTxExplorerTemplate,
  explorerBlocksHash,
  explorerExtractionHash,
  explorerHome,
  explorerLogoUrl,
  explorerPeersHash,
  explorerProfitabilityHash,
  explorerRichlistHash,
} from "@/lib/explorer-links";

export const EXPLORER_HOME = explorerHome("verium");
export const EXPLORER_LOGO_URL = explorerLogoUrl("verium");
export const EXPLORER_REST_BASE =
  "https://explorer-vrm.vericonomy.com/rest/api/1";
export const EXPLORER_BLOCKS = explorerBlocksHash("verium");
export const EXPLORER_PEERS = explorerPeersHash("verium");
export const EXPLORER_EXTRACTION = explorerExtractionHash("verium");
export const EXPLORER_RICHLIST = explorerRichlistHash("verium");
export const EXPLORER_PROFITABILITY = explorerProfitabilityHash("verium");

export const DOCS_HOME = "https://docs.vericonomy.com/";
export const DOCS_DOWNLOADS = "https://docs.vericonomy.com/en/Downloads";

export const CDN_ROOT = "https://files.vericonomy.com/vrm/";
export const CDN_RELEASES = "https://files.vericonomy.com/vrm/releases/";
export const VERSION_FEED = "https://files.vericonomy.com/vrm/VERSION_VRM.json";

export const BOOTSTRAP_URL_X64 =
  "https://files.vericonomy.com/vrm/bootstrap/verium-bootstrap.zip";
export const BOOTSTRAP_URL_ARM =
  "https://files.vericonomy.com/vrm/bootstrap-arm/bootstrap.zip";
export const BOOTSTRAP_CDN_INDEX =
  "https://files.vericonomy.com/vrm/bootstrap/";

/** Build candidate bootstrap URLs (canonical + recent dated archives). */
export function bootstrapDownloadCandidates(): string[] {
  const urls = [BOOTSTRAP_URL_X64];
  const today = new Date();
  for (let daysBack = 0; daysBack < 14; daysBack += 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - daysBack);
    const iso = d.toISOString().slice(0, 10);
    urls.push(`${BOOTSTRAP_CDN_INDEX}verium-bootstrap-${iso}.zip`);
  }
  return urls;
}

export const COMMUNITY_WEBSITE = "https://staged.vericonomy.com";
export const COMMUNITY_TWITTER = "https://twitter.com/vericonomy";

/**
 * Default tx URL template. `%s` is replaced with the transaction hash, matching
 * the legacy Qt strThirdPartyTxUrls convention (see
 * src/qt/transactionview.cpp openThirdPartyTxUrl).
 *
 * The fragment path is the best guess for the current explorer build; users
 * can override it in Settings.
 */
export const DEFAULT_TX_EXPLORER_TEMPLATE =
  defaultTxExplorerTemplate("verium");

export const DEFAULT_BLOCK_EXPLORER_TEMPLATE =
  defaultBlockExplorerTemplate("verium");

export const DEFAULT_ADDRESS_EXPLORER_TEMPLATE =
  defaultAddressExplorerTemplate("verium");

export function buildTxExplorerUrl(template: string, txid: string): string {
  const safe =
    template && template.includes("%s")
      ? template
      : DEFAULT_TX_EXPLORER_TEMPLATE;
  return safe.replace("%s", encodeURIComponent(txid));
}

export function buildBlockExplorerUrl(
  template: string,
  blockHashOrHeight: string | number,
): string {
  const safe =
    template && template.includes("%s")
      ? template
      : DEFAULT_BLOCK_EXPLORER_TEMPLATE;
  return safe.replace("%s", encodeURIComponent(String(blockHashOrHeight)));
}

export function buildAddressExplorerUrl(
  template: string,
  address: string,
): string {
  const safe =
    template && template.includes("%s")
      ? template
      : DEFAULT_ADDRESS_EXPLORER_TEMPLATE;
  return safe.replace("%s", encodeURIComponent(address));
}
