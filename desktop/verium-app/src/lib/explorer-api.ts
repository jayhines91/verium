import { invoke } from "@tauri-apps/api/core";

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

export function fetchExplorerStats(): Promise<ExplorerStats> {
  return invoke<ExplorerStats>("fetch_explorer_stats");
}

export function fetchExplorerBlocks(limit = 10): Promise<ExplorerBlock[]> {
  return invoke<ExplorerBlock[]>("fetch_explorer_blocks", { limit });
}

export function fetchExplorerTransactions(
  limit = 25,
): Promise<ExplorerTransaction[]> {
  return invoke<ExplorerTransaction[]>("fetch_explorer_transactions", {
    limit,
  });
}

export function fetchExplorerExtraction(
  limit = 20,
): Promise<ExplorerExtractionEntry[]> {
  return invoke<ExplorerExtractionEntry[]>("fetch_explorer_extraction", {
    limit,
  });
}

export function fetchExplorerChainTips(): Promise<ExplorerChainTip[]> {
  return invoke<ExplorerChainTip[]>("fetch_explorer_chain_tips");
}

export function fetchExplorerPeers(): Promise<ExplorerPeerEntry[]> {
  return invoke<ExplorerPeerEntry[]>("fetch_explorer_peers_cmd");
}

export function getExplorerLogoUrl(): Promise<string> {
  return invoke<string>("get_explorer_logo_url");
}
