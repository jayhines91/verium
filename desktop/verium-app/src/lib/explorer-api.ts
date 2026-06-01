import { invoke } from "@tauri-apps/api/core";
import type { CoinId } from "@/lib/coin/profile";

export interface ExplorerStats {
  network_hash?: number;
  supply?: number;
  height?: number;
  block_reward?: number;
  difficulty?: number;
  blocks_per_hour?: number;
  block_time_min?: number;
  pooled_tx?: number;
  price_usd?: number;
  price_btc?: number;
  market_cap_usd?: number;
  volume_24h_usd?: number;
  stake_interest?: number;
  stake_inflation?: number;
  net_stake_weight?: number;
  pos_difficulty?: number;
  pow_difficulty?: number;
  fetched_at: number;
  source?: string;
}

export interface ExplorerBlock {
  id: number;
  hash: string;
  height: number;
  time: number;
  mint?: string;
  difficulty?: string;
  n_tx?: number;
  miner_address?: string;
  size?: number;
  output_total?: string;
  output_count?: number;
}

export interface ExplorerTransaction {
  id: number;
  txid: string;
  time: number;
  fee?: string;
  output_total?: string;
  block_height?: number;
  block_hash?: string;
}

export interface ExplorerExtractionEntry {
  rank?: string;
  address: string;
  count?: string;
}

export interface ExplorerChainTip {
  id: number;
  height: number;
  hash: string;
  branchlen: number;
  status_name?: string;
}

export interface ExplorerPeerEntry {
  id: number;
  address: string;
  ip: string;
  port: number;
  subversion: string;
  protocol_version: number;
  connected_on_explorer: boolean;
  last_seen?: string;
}

export function isExplorerApiEnabled(): Promise<boolean> {
  return invoke<boolean>("is_explorer_api_enabled");
}

export function fetchExplorerStats(coin: CoinId): Promise<ExplorerStats> {
  return invoke<ExplorerStats>("fetch_explorer_stats", { coin });
}

export function fetchExplorerBlocks(
  coin: CoinId,
  limit = 10,
): Promise<ExplorerBlock[]> {
  return invoke<ExplorerBlock[]>("fetch_explorer_blocks", { coin, limit });
}

export function fetchExplorerTransactions(
  coin: CoinId,
  limit = 25,
): Promise<ExplorerTransaction[]> {
  return invoke<ExplorerTransaction[]>("fetch_explorer_transactions", {
    coin,
    limit,
  });
}

export function fetchExplorerExtraction(
  coin: CoinId,
  limit = 20,
  period = "month",
): Promise<ExplorerExtractionEntry[]> {
  return invoke<ExplorerExtractionEntry[]>("fetch_explorer_extraction", {
    coin,
    limit,
    period,
  });
}

export function fetchExplorerChainTips(coin: CoinId): Promise<ExplorerChainTip[]> {
  return invoke<ExplorerChainTip[]>("fetch_explorer_chain_tips", { coin });
}

export function fetchExplorerPeers(coin: CoinId): Promise<ExplorerPeerEntry[]> {
  return invoke<ExplorerPeerEntry[]>("fetch_explorer_peers_cmd", { coin });
}

export function getExplorerLogoUrl(coin: CoinId): Promise<string> {
  return invoke<string>("get_explorer_logo_url", { coin });
}
