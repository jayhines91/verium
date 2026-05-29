// Copyright (c) 2026 The Vericonomy developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.
//
// React-side wrappers for Binary Chain v3 (DACE) RPC commands.
// See vericoin/doc/dace/ for the protocol specifications.

import { invoke } from "@tauri-apps/api/core";
import type { CoinId } from "@/lib/coin/profile";

/** DACE activation status and live state. Returned by `binarychain_status`. */
export interface BinaryChainStatus {
  activated: boolean;
  current_epoch: number;
  active_anchor_hash: string | null;
  active_anchor_epoch: number | null;
  stale_coupled: boolean;
  stale_reason?: string;
  bonded_tickets_active: number;
  bonded_tickets_total_amount: number;
  paired_header_lag_p50_sec: number;
  paired_header_lag_p95_sec: number;
  paired_header_lag_p99_sec: number;
}

/** Threat-model metrics. Returned by `binarychain_metrics`. */
export interface BinaryChainMetrics {
  divergent_beacon_selections: number;
  reorgs_at_beacon: number;
  committee_missed_votes: number;
  foreign_payee_rejections: number;
  consecutive_missed_anchors: number;
  ibd_replay_consensus_diffs: number;
  stale_coupling_entries: number;
  recovery_anchors_built: number;
  recovery_anchors_activated: number;
  claim_redemptions_total: number;
  claim_redemptions_rejected: number;
  slashes_total: number;
  top10_ticket_share: number;
  seat_to_bonded_ratio_top10: number;
}

/** Currently activated Joint Anchor. Returned by `binarychain_anchor`. */
export interface BinaryChainAnchor {
  epoch: number;
  prev_anchor_hash: string;
  beacon_ref: string;
  vrc_checkpoint_hash: string;
  vrc_checkpoint_height: number;
  reward_root_vrc_prev: string;
  reward_root_vrm_prev: string;
  committee_root: string;
}

export async function rpcBinaryChainStatus(
  coin: CoinId,
): Promise<BinaryChainStatus> {
  return invoke<BinaryChainStatus>("binarychain_status", { coin });
}

export async function rpcBinaryChainMetrics(
  coin: CoinId,
): Promise<BinaryChainMetrics> {
  return invoke<BinaryChainMetrics>("binarychain_metrics", { coin });
}

export async function rpcBinaryChainAnchor(
  coin: CoinId,
): Promise<BinaryChainAnchor | null> {
  const result = await invoke<BinaryChainAnchor | null>(
    "binarychain_anchor",
    { coin },
  );
  return result ?? null;
}

export async function rpcBinaryChainRedeemClaim(
  coin: CoinId,
  leafHash: string,
): Promise<{ txid: string }> {
  return invoke<{ txid: string }>("binarychain_redeem_claim", {
    coin,
    leafHash,
  });
}

export async function rpcBinaryChainRegisterTicket(
  coin: CoinId,
  stakeOutpoint: string,
  operatorPubkey: string,
): Promise<{ txid: string; ticket_id: string }> {
  return invoke("binarychain_register_ticket", {
    coin,
    stakeOutpoint,
    operatorPubkey,
  });
}

export async function rpcBinaryChainUnbondTicket(
  coin: CoinId,
  ticketId: string,
): Promise<{ txid: string }> {
  return invoke("binarychain_unbond_ticket", { coin, ticketId });
}

export interface BinaryChainFundResult {
  network: string;
  address: string;
  blocks: string[];
}

/** Binarytest-only: mine `nblocks` PoW blocks into the wallet so a fresh
 *  binarytest install has spendable / stakeable funds. */
export async function rpcBinaryChainFundWallet(
  coin: CoinId,
  nblocks = 10,
  address?: string,
): Promise<BinaryChainFundResult> {
  return invoke<BinaryChainFundResult>("binarychain_fund_wallet", {
    coin,
    nblocks,
    address: address ?? "",
  });
}
