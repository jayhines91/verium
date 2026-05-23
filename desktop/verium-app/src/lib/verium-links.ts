/**
 * Central source of truth for Vericonomy public resources.
 *
 * Mirrors the URL constants in src/qt/guiconstants.h and src/downloader.h so
 * the new desktop UI and the legacy Qt wallet point at the same official
 * endpoints.
 */

export const EXPLORER_HOME = "https://explorer-vrm.vericonomy.com/";
export const EXPLORER_LOGO_URL =
  "https://explorer-vrm.vericonomy.com/assets/images/logo.png";
export const EXPLORER_REST_BASE =
  "https://explorer-vrm.vericonomy.com/rest/api/1";
export const EXPLORER_BLOCKS =
  "https://explorer-vrm.vericonomy.com/#homeBlocks";
export const EXPLORER_PEERS = "https://explorer-vrm.vericonomy.com/#homePeers";
export const EXPLORER_EXTRACTION =
  "https://explorer-vrm.vericonomy.com/#homeExtraction";
export const EXPLORER_RICHLIST =
  "https://explorer-vrm.vericonomy.com/#homeRichlist";
export const EXPLORER_PROFITABILITY =
  "https://explorer-vrm.vericonomy.com/#homeProfitability";

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
  "https://explorer-vrm.vericonomy.com/#tx/%s";

export const DEFAULT_BLOCK_EXPLORER_TEMPLATE =
  "https://explorer-vrm.vericonomy.com/#block/%s";

export const DEFAULT_ADDRESS_EXPLORER_TEMPLATE =
  "https://explorer-vrm.vericonomy.com/#address/%s";

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
