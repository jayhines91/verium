use std::path::Path;

use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use chrono::{DateTime, Utc};

use crate::error::AppResult;

/// Read the tail of `<datadir>/debug.log` and return up to `max_lines` lines.
///
/// Reads at most the trailing 256 KiB of the file so that the operation
/// stays bounded even for very large logs.
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

const CORRUPTION_MARKERS: &[&str] = &[
    "Corrupted block database detected",
    "found bad block",
    "VerifyDB:",
    "Please restart with -reindex",
    "Aborted block database rebuild",
];

const SYNC_STALL_MARKERS: &[&str] = &[
    "ProcessNewBlock: AcceptBlock FAILED (bad-cb-timestamp",
    "ProcessNewBlock: AcceptBlock FAILED (bad-tx-timestamp",
];

const CORRUPTION_MAX_AGE_SECS: i64 = 20 * 60;

fn parse_log_timestamp(line: &str) -> Option<DateTime<Utc>> {
    let ts = line.get(0..20)?;
    DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// True when strict timestamp rules in older veriumd builds reject valid mainnet blocks.
pub fn is_timestamp_rule_failure(line: &str) -> bool {
    line.contains("bad-cb-timestamp") || line.contains("bad-tx-timestamp")
}

/// Live sync stuck because incoming blocks fail timestamp validation (outdated WSL build).
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

/// If recent debug.log lines indicate chain DB corruption, return a short summary.
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

/// True when a recent debug.log line shows another veriumd holds the datadir lock.
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
