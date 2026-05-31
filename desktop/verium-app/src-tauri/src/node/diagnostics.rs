//! Parse `debug.log` for node lifecycle diagnostics.

use std::path::Path;

use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use chrono::{DateTime, Utc};

use crate::coin_profile::CoinId;
use crate::config::{debug_log_candidate_dirs, DaemonConfig};
use crate::error::AppResult;

pub async fn tail_debug_log(datadir: &Path, max_lines: usize) -> AppResult<Vec<String>> {
    let path = datadir.join("debug.log");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let mut file = fs::File::open(&path).await?;
    let len = file.metadata().await?.len();
    const WINDOW: u64 = 256 * 1024;
    let start = len.saturating_sub(WINDOW);
    file.seek(std::io::SeekFrom::Start(start)).await?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    file.read_to_end(&mut buf).await?;
    let text = String::from_utf8_lossy(&buf);
    let mut lines: Vec<&str> = text.lines().collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    let take = lines.len().saturating_sub(max_lines);
    Ok(lines[take..].iter().map(|s| s.to_string()).collect())
}

/// Tail `debug.log` from every plausible datadir for this coin; return the richest result.
pub async fn tail_coin_debug_log(
    coin: CoinId,
    cfg: &DaemonConfig,
    max_lines: usize,
) -> AppResult<Vec<String>> {
    let mut best: Vec<String> = Vec::new();
    for dir in debug_log_candidate_dirs(coin, cfg) {
        let lines = tail_debug_log(&dir, max_lines).await?;
        if lines.len() > best.len() {
            best = lines;
        }
    }
    Ok(best)
}

const CORRUPTION_MARKERS: &[&str] = &[
    "Corrupted block database detected",
    "found bad block",
    "VerifyDB:",
    "Please restart with -reindex",
    "Error initializing block database",
    "Error loading block database",
    "LoadBlockIndexGuts",
    "failed to read value",
    "Aborted block database rebuild",
    "*** Failed to read block",
    "A fatal internal error occurred",
];

const SYNC_STALL_MARKERS: &[&str] = &[
    "ProcessNewBlock: AcceptBlock FAILED (bad-cb-timestamp",
    "ProcessNewBlock: AcceptBlock FAILED (bad-tx-timestamp",
];

const INVALID_BLOCK_STALL_MARKER: &str = "is marked invalid";

/// Vericoin PoS sync can mark blocks invalid when the tx index lags the chain tip.
const TXINDEX_POS_STALL_MARKERS: &[&str] = &[
    "tx missing in tx index",
    "unable to get coin age for coinstake",
    "Syncing txindex with block chain",
];

const CORRUPTION_MAX_AGE_SECS: i64 = 20 * 60;
const NODE_STARTING_MAX_AGE_SECS: i64 = 180;

fn parse_log_timestamp(line: &str) -> Option<DateTime<Utc>> {
    let ts = line.get(0..20)?;
    DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

pub fn is_timestamp_rule_failure(line: &str) -> bool {
    line.contains("bad-cb-timestamp") || line.contains("bad-tx-timestamp")
}

pub fn detect_sync_stall(lines: &[String]) -> Option<String> {
    let now = Utc::now();
    for line in lines.iter().rev().take(40) {
        if !SYNC_STALL_MARKERS.iter().any(|m| line.contains(m)) {
            continue;
        }
        if let Some(ts) = parse_log_timestamp(line) {
            let age = now.signed_duration_since(ts).num_seconds();
            if age > CORRUPTION_MAX_AGE_SECS {
                continue;
            }
        }
        return Some(line.trim().to_string());
    }
    None
}

fn extract_block_hash_from_invalid_line(line: &str) -> Option<String> {
    let needle = "block ";
    let start = line.find(needle)? + needle.len();
    let hash = line[start..].split_whitespace().next()?;
    if hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(hash.to_string())
    } else {
        None
    }
}

/// Latest `Syncing txindex with block chain from height N` line in debug.log.
pub fn parse_txindex_sync_height(lines: &[String]) -> Option<u64> {
    parse_txindex_log_height(lines, "Syncing txindex with block chain from height ")
}

/// `txindex is enabled at height N` — index finished catching up to the chain tip.
pub fn parse_txindex_enabled_height(lines: &[String]) -> Option<u64> {
    parse_txindex_log_height(lines, "txindex is enabled at height ")
}

fn parse_txindex_log_height(lines: &[String], needle: &str) -> Option<u64> {
    let now = Utc::now();
    for line in lines.iter().rev().take(60) {
        let Some(idx) = line.find(needle) else {
            continue;
        };
        if let Some(ts) = parse_log_timestamp(line) {
            let age = now.signed_duration_since(ts).num_seconds();
            if age > CORRUPTION_MAX_AGE_SECS {
                continue;
            }
        }
        let rest = &line[idx + needle.len()..];
        let num = rest.split_whitespace().next()?;
        return num.parse().ok();
    }
    None
}

/// Best txindex position for UI/heal: enabled height wins over in-progress sync height.
pub fn effective_txindex_height(lines: &[String]) -> Option<u64> {
    parse_txindex_enabled_height(lines).or_else(|| parse_txindex_sync_height(lines))
}

/// Txindex background thread finished (see `txindex thread exit` / `txindex is enabled`).
pub fn detect_txindex_complete(lines: &[String]) -> bool {
    let now = Utc::now();
    for line in lines.iter().rev().take(40) {
        if !line.contains("txindex thread exit") && !line.contains("txindex is enabled at height") {
            continue;
        }
        if let Some(ts) = parse_log_timestamp(line) {
            let age = now.signed_duration_since(ts).num_seconds();
            if age > CORRUPTION_MAX_AGE_SECS {
                continue;
            }
        }
        return true;
    }
    false
}

/// Recent ConnectTip / GetCoinAge failures (txindex not ready for PoS blocks).
pub fn detect_recent_coin_age_failure(lines: &[String]) -> bool {
    let now = Utc::now();
    for line in lines.iter().rev().take(40) {
        if !line.contains("unable to get coin age for coinstake")
            && !line.contains("tx missing in tx index in GetCoinAge")
        {
            continue;
        }
        if let Some(ts) = parse_log_timestamp(line) {
            let age = now.signed_duration_since(ts).num_seconds();
            if age > 120 {
                continue;
            }
        }
        return true;
    }
    false
}

/// Recent log lines suggest PoS validation failed because the tx index is behind the chain.
pub fn detect_txindex_pos_stall(lines: &[String]) -> bool {
    if detect_txindex_complete(lines) {
        return false;
    }
    let now = Utc::now();
    for line in lines.iter().rev().take(80) {
        if !TXINDEX_POS_STALL_MARKERS.iter().any(|m| line.contains(m)) {
            continue;
        }
        if let Some(ts) = parse_log_timestamp(line) {
            let age = now.signed_duration_since(ts).num_seconds();
            if age > CORRUPTION_MAX_AGE_SECS {
                continue;
            }
        }
        return true;
    }
    false
}

/// All block hashes recently flagged invalid in debug.log (most frequent first).
pub fn detect_invalid_block_hashes(lines: &[String]) -> Vec<String> {
    let now = Utc::now();
    let mut counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for line in lines.iter().rev().take(80) {
        if !line.contains(INVALID_BLOCK_STALL_MARKER) {
            continue;
        }
        if let Some(ts) = parse_log_timestamp(line) {
            let age = now.signed_duration_since(ts).num_seconds();
            if age > CORRUPTION_MAX_AGE_SECS {
                continue;
            }
        }
        if let Some(hash) = extract_block_hash_from_invalid_line(line) {
            *counts.entry(hash).or_insert(0) += 1;
        }
    }
    let mut ordered: Vec<_> = counts.into_iter().collect();
    ordered.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    ordered.into_iter().map(|(hash, _)| hash).collect()
}

/// Detect sync stuck because a main-chain block was incorrectly marked invalid in
/// the local block index (peers disconnect when relaying that header).
pub fn detect_invalid_block_stall(lines: &[String]) -> Option<String> {
    detect_invalid_block_hashes(lines).into_iter().next()
}

pub fn detect_chain_corruption(lines: &[String]) -> Option<String> {
    let now = Utc::now();
    for line in lines.iter().rev().take(40) {
        if !CORRUPTION_MARKERS.iter().any(|m| line.contains(m)) {
            continue;
        }
        if let Some(ts) = parse_log_timestamp(line) {
            let age = now.signed_duration_since(ts).num_seconds();
            if age > CORRUPTION_MAX_AGE_SECS {
                continue;
            }
        }
        return Some(line.trim().to_string());
    }
    None
}

const DATADIR_LOCK_MARKERS: &[&str] = &[
    "Cannot obtain a lock on data directory",
    "Verium is probably already running",
];

const NODE_STARTING_MARKERS: &[&str] = &[
    "Loading block index",
    "Opening LevelDB",
    "init message",
    "Verifying blocks",
    "Rewinding blocks",
    "LoadBlockIndex",
    "Activating best chain",
    "Waiting for genesis block",
    "Pre-allocating up to",
    "Reindexing block file",
];

pub fn detect_node_starting(lines: &[String]) -> bool {
    let now = Utc::now();
    for line in lines.iter().rev().take(40) {
        if !NODE_STARTING_MARKERS.iter().any(|m| line.contains(m)) {
            continue;
        }
        if let Some(ts) = parse_log_timestamp(line) {
            let age = now.signed_duration_since(ts).num_seconds();
            if age > NODE_STARTING_MAX_AGE_SECS {
                continue;
            }
        }
        return true;
    }
    false
}

pub fn current_log_session_start(lines: &[String]) -> usize {
    for (idx, line) in lines.iter().enumerate().rev() {
        if line.contains(" version v") && (line.contains("Vericoin") || line.contains("Verium")) {
            return idx;
        }
    }
    0
}

pub fn current_log_session(lines: &[String]) -> Vec<String> {
    let start = current_log_session_start(lines);
    lines[start..].to_vec()
}

pub fn detect_chain_corruption_session(lines: &[String]) -> Option<String> {
    detect_chain_corruption(&current_log_session(lines))
}

#[derive(Debug, Clone)]
pub struct ReindexProgress {
    pub header: u64,
    pub peer_height: Option<u64>,
    pub message: String,
}

const REINDEX_PROGRESS_MAX_AGE_SECS: i64 = 600;

/// Matches frontend `SYNCED_BLOCK_LAG_THRESHOLD`.
const RPC_SYNCED_BLOCK_LAG: u64 = 2;

/// True when getblockchaininfo indicates the node is caught up (not IBD, blocks ≈ headers).
pub fn rpc_reports_synced(
    connected: bool,
    initial_block_download: Option<bool>,
    blocks: Option<u64>,
    headers: Option<u64>,
) -> bool {
    if !connected {
        return false;
    }
    if initial_block_download.unwrap_or(false) {
        return false;
    }
    let blocks = blocks.unwrap_or(0);
    let headers = headers.unwrap_or(blocks);
    blocks.saturating_add(RPC_SYNCED_BLOCK_LAG) >= headers
}

pub fn detect_reindex_progress(session: &[String]) -> Option<ReindexProgress> {
    let now = Utc::now();
    let mut peer_height: Option<u64> = None;
    let mut header: Option<u64> = None;

    for line in session.iter().rev().take(40) {
        if let Some(ts) = parse_log_timestamp(line) {
            let age = now.signed_duration_since(ts).num_seconds();
            if age > REINDEX_PROGRESS_MAX_AGE_SECS {
                continue;
            }
        } else {
            continue;
        }

        if line.contains("New outbound peer connected") {
            if let Some(pos) = line.find("blocks=") {
                let rest = &line[pos + 7..];
                if let Ok(h) = rest.split(',').next()?.trim().parse::<u64>() {
                    peer_height = Some(h);
                }
            }
        }
        if line.contains("Checking block header #") {
            if let Some(pos) = line.find('#') {
                let rest = &line[pos + 1..];
                if let Ok(h) = rest.split_whitespace().next()?.parse::<u64>() {
                    header = Some(h);
                    break;
                }
            }
        }
        if line.contains("Reindexing block file") && header.is_none() {
            header = Some(0);
        }
    }

    header.map(|h| ReindexProgress {
        header: h,
        peer_height,
        message: if let Some(total) = peer_height.filter(|t| *t > 0) {
            format!("Reindexing block headers ({h} / ~{total})…")
        } else {
            format!("Reindexing block headers ({h} processed)…")
        },
    })
}

/// True when the current session shows an active `-reindex` rebuild. Header validation
/// (`Checking block header #…`) also runs during normal sync and must not count alone.
pub fn detect_reindex_active_session(lines: &[String], pending_reindex: bool) -> bool {
    let session = current_log_session(lines);
    if detect_reindex_file_rebuild_session(&session) {
        return true;
    }
    pending_reindex && detect_reindex_progress(&session).is_some()
}

/// True when the current log session shows an actual `-reindex` rebuild (not
/// ordinary header sync during IBD).
pub fn detect_reindex_file_rebuild_session(lines: &[String]) -> bool {
    let session = current_log_session(lines);
    session.iter().any(|line| {
        line.contains("Reindexing block file")
            || line.contains("Command-line arg: reindex")
            || line.contains("Wiping LevelDB")
    })
}

pub fn log_recently_modified(log_path: &Path, max_age: std::time::Duration) -> bool {
    let Ok(meta) = std::fs::metadata(log_path) else {
        return false;
    };
    let Ok(modified) = meta.modified() else {
        return false;
    };
    modified
        .elapsed()
        .map(|elapsed| elapsed < max_age)
        .unwrap_or(false)
}

pub fn detect_datadir_lock_conflict(lines: &[String]) -> Option<String> {
    let now = Utc::now();
    for line in lines.iter().rev().take(40) {
        if !DATADIR_LOCK_MARKERS.iter().any(|m| line.contains(m)) {
            continue;
        }
        if let Some(ts) = parse_log_timestamp(line) {
            let age = now.signed_duration_since(ts).num_seconds();
            if age > CORRUPTION_MAX_AGE_SECS {
                continue;
            }
        }
        return Some(
            "Another Verium instance is already using this data directory. \
             Quit Verium-Qt or any other veriumd using the same folder, then try again."
                .into(),
        );
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn recent_ts() -> String {
        format!("{}Z", Utc::now().format("%Y-%m-%dT%H:%M:%S"))
    }

    #[test]
    fn parses_txindex_sync_height() {
        let lines = vec![format!(
            "{} Syncing txindex with block chain from height 2262075",
            recent_ts()
        )];
        assert_eq!(parse_txindex_sync_height(&lines), Some(2_262_075));
    }

    #[test]
    fn detects_txindex_pos_stall() {
        let lines = vec![format!(
            "{} ERROR: ConnectTip: ConnectBlock failed, unable to get coin age for coinstake",
            recent_ts()
        )];
        assert!(detect_txindex_pos_stall(&lines));
    }

    #[test]
    fn txindex_complete_clears_stall_and_uses_enabled_height() {
        let ts = recent_ts();
        let lines = vec![
            format!("{ts} Syncing txindex with block chain from height 6971503"),
            format!("{ts} txindex is enabled at height 6974778"),
            format!("{ts} txindex thread exit"),
        ];
        assert!(detect_txindex_complete(&lines));
        assert!(!detect_txindex_pos_stall(&lines));
        assert_eq!(effective_txindex_height(&lines), Some(6_974_778));
    }

    #[test]
    fn detects_invalid_block_stall_hash() {
        let hash = "8241e46975881e16cfaf0c8d380427b501852985a76e98f4e6eb79f9287db89f";
        let lines = vec![format!(
            "{} ERROR: AcceptBlockHeader: block {hash} is marked invalid",
            recent_ts()
        )];
        assert_eq!(detect_invalid_block_stall(&lines).as_deref(), Some(hash));
    }

    #[test]
    fn detects_datadir_lock_message() {
        let lines = vec![format!(
            "{} Cannot obtain a lock on data directory",
            recent_ts()
        )];
        assert!(detect_datadir_lock_conflict(&lines).is_some());
    }

    #[test]
    fn detects_node_starting_marker() {
        let lines = vec![format!("{} Loading block index", recent_ts())];
        assert!(detect_node_starting(&lines));
    }

    #[test]
    fn reindex_file_rebuild_requires_reindex_markers() {
        let header_only = vec![
            format!("{} Vericoin version v2.0.1", recent_ts()),
            format!("{} Checking block header #12 (PoW) work", recent_ts()),
        ];
        assert!(!detect_reindex_file_rebuild_session(&header_only));

        let rebuilding = vec![
            format!("{} Vericoin version v2.0.1", recent_ts()),
            format!("{} Reindexing block file blk00000.dat...", recent_ts()),
        ];
        assert!(detect_reindex_file_rebuild_session(&rebuilding));
    }

    #[test]
    fn reindex_active_session_detects_late_header_progress_with_pending_flag() {
        let late_headers = vec![
            format!("{} Checking block header #23998 (PoW) work", recent_ts()),
            format!("{} Checking block header #23999 (PoW) work", recent_ts()),
            format!("{} Checking block header #24000 (PoW) work", recent_ts()),
            format!(
                "{} Synchronizing blockheaders, height: 24000 (~2.34%)",
                recent_ts()
            ),
        ];
        assert!(!detect_reindex_file_rebuild_session(&late_headers));
        assert!(!detect_reindex_active_session(&late_headers, false));
        assert!(detect_reindex_active_session(&late_headers, true));
    }

    #[test]
    fn header_validation_alone_is_not_reindex() {
        let synced_session = vec![
            format!("{} Vericoin version v2.0.1", recent_ts()),
            format!(
                "{} Checking block header #6977398 (PoW) work",
                recent_ts()
            ),
        ];
        assert!(!detect_reindex_file_rebuild_session(&synced_session));
        assert!(!detect_reindex_active_session(&synced_session, false));
        assert!(rpc_reports_synced(true, Some(false), Some(6_977_398), Some(6_977_398)));
    }
}
