use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};

pub const EXPLORER_API_ENABLED: bool = true;

pub const EXPLORER_BASE: &str = "https://explorer-vrm.vericonomy.com";
pub const EXPLORER_LOGO_URL: &str =
    "https://explorer-vrm.vericonomy.com/assets/images/logo.png";
pub const EXPLORER_REST: &str = "https://explorer-vrm.vericonomy.com/rest/api/1";

const CACHE_TTL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize)]
pub struct ExplorerStats {
    pub network_hash: Option<f64>,
    pub supply: Option<f64>,
    pub height: Option<u64>,
    pub block_reward: Option<f64>,
    pub difficulty: Option<f64>,
    pub blocks_per_hour: Option<f64>,
    pub block_time_min: Option<f64>,
    pub pooled_tx: Option<u64>,
    pub price_usd: Option<f64>,
    pub price_btc: Option<f64>,
    pub market_cap_usd: Option<f64>,
    pub volume_24h_usd: Option<f64>,
    pub fetched_at: u64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplorerChainTip {
    pub id: u64,
    pub height: u64,
    pub hash: String,
    pub branchlen: u64,
    pub status_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplorerBlock {
    pub id: u64,
    pub hash: String,
    pub height: u64,
    pub time: u64,
    pub mint: Option<String>,
    pub difficulty: Option<String>,
    pub n_tx: Option<u64>,
    pub miner_address: Option<String>,
    pub size: Option<u64>,
    pub output_total: Option<String>,
    pub output_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplorerTransaction {
    pub id: u64,
    pub txid: String,
    pub time: u64,
    pub fee: Option<String>,
    pub output_total: Option<String>,
    pub block_height: Option<u64>,
    pub block_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplorerExtractionEntry {
    pub rank: Option<String>,
    pub address: String,
    pub count: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplorerPeerEntry {
    pub id: u64,
    pub address: String,
    pub ip: String,
    pub port: u16,
    pub subversion: String,
    pub protocol_version: u64,
    pub connected_on_explorer: bool,
    pub last_seen: Option<String>,
}

struct TimedEntry<T> {
    at: Instant,
    value: T,
}

struct CacheStore {
    stats: Option<TimedEntry<ExplorerStats>>,
    blocks: Option<TimedEntry<Vec<ExplorerBlock>>>,
    transactions: Option<TimedEntry<Vec<ExplorerTransaction>>>,
    extraction: Option<TimedEntry<Vec<ExplorerExtractionEntry>>>,
    chain_tips: Option<TimedEntry<Vec<ExplorerChainTip>>>,
    peers: Option<TimedEntry<Vec<ExplorerPeerEntry>>>,
}

impl Default for CacheStore {
    fn default() -> Self {
        Self {
            stats: None,
            blocks: None,
            transactions: None,
            extraction: None,
            chain_tips: None,
            peers: None,
        }
    }
}

static CACHE: once_cell::sync::Lazy<Mutex<CacheStore>> =
    once_cell::sync::Lazy::new(|| Mutex::new(CacheStore::default()));

fn http_client() -> AppResult<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("verium-desktop-app/0.1")
        .build()?)
}

async fn get_json(client: &reqwest::Client, url: &str) -> AppResult<Value> {
    let resp = client.get(url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::other(format!(
            "explorer api {} returned http {}",
            url,
            resp.status()
        )));
    }
    Ok(resp.json().await?)
}

fn parse_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

fn parse_u64(v: &Value) -> Option<u64> {
    match v {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

pub async fn fetch_network_stats() -> AppResult<ExplorerStats> {
    if !EXPLORER_API_ENABLED {
        return Err(AppError::other("explorer api disabled"));
    }

    if let Some(cached) = read_stats_cache().await {
        return Ok(cached);
    }

    let client = http_client()?;

    let mining = get_json(
        &client,
        &format!("{EXPLORER_REST}/rpc/getmininginfo"),
    )
    .await?;

    let supply_info = get_json(
        &client,
        &format!("{EXPLORER_REST}/rpc/gettxoutsetinfo"),
    )
    .await
    .ok();

    let price_info = get_json(
        &client,
        &format!("{EXPLORER_REST}/coingecko/price"),
    )
    .await
    .ok();

    let price_usd = price_info
        .as_ref()
        .and_then(|p| p.get("veriumreserve"))
        .and_then(|v| v.get("usd"))
        .and_then(parse_f64);

    let price_btc = price_info
        .as_ref()
        .and_then(|p| p.get("veriumreserve"))
        .and_then(|v| v.get("btc"))
        .and_then(parse_f64);

    let market_cap_usd = price_info
        .as_ref()
        .and_then(|p| p.get("veriumreserve"))
        .and_then(|v| v.get("usd_market_cap"))
        .and_then(parse_f64);

    let volume_24h_usd = price_info
        .as_ref()
        .and_then(|p| p.get("veriumreserve"))
        .and_then(|v| v.get("usd_24h_vol"))
        .and_then(parse_f64);

    let stats = ExplorerStats {
        network_hash: mining.get("networkhashps").and_then(parse_f64),
        supply: supply_info
            .as_ref()
            .and_then(|s| s.get("total_amount"))
            .and_then(parse_f64),
        height: mining
            .get("blocks")
            .and_then(parse_u64)
            .or_else(|| {
                supply_info
                    .as_ref()
                    .and_then(|s| s.get("height"))
                    .and_then(parse_u64)
            }),
        block_reward: mining.get("blockreward").and_then(parse_f64),
        difficulty: mining.get("difficulty").and_then(parse_f64),
        blocks_per_hour: mining.get("blocksperhour").and_then(parse_f64),
        block_time_min: mining.get("blocktime").and_then(parse_f64),
        pooled_tx: mining.get("pooledtx").and_then(parse_u64),
        price_usd,
        price_btc,
        market_cap_usd,
        volume_24h_usd,
        fetched_at: now_secs(),
        source: "explorer-rest".to_string(),
    };

    write_stats_cache(stats.clone()).await;
    Ok(stats)
}

const PEERS_CACHE_TTL: Duration = Duration::from_secs(300);

pub async fn fetch_explorer_peers() -> AppResult<Vec<ExplorerPeerEntry>> {
    if !EXPLORER_API_ENABLED {
        return Err(AppError::other("explorer api disabled"));
    }

    if let Some(cached) = read_peers_cache().await {
        return Ok(cached);
    }

    let client = http_client()?;
    let versions = get_json(&client, &format!("{EXPLORER_REST}/peer?limit=50")).await?;
    let versions = versions
        .as_array()
        .ok_or_else(|| AppError::other("peer versions response is not an array"))?;

    let mut by_address: std::collections::HashMap<String, ExplorerPeerEntry> =
        std::collections::HashMap::new();

    for version in versions {
        let version_id = match version.get("version_id").and_then(parse_u64) {
            Some(id) => id,
            None => continue,
        };
        let subversion = version
            .get("version_subVersion")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let protocol_version = version
            .get("version_version")
            .and_then(parse_u64)
            .unwrap_or(0);

        let detail = get_json(&client, &format!("{EXPLORER_REST}/peer/{version_id}")).await?;
        let Some(peer_list) = detail.get("peers").and_then(|p| p.as_array()) else {
            continue;
        };

        for peer in peer_list {
            let ip = peer.get("ip").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if ip.is_empty() {
                continue;
            }
            let port = peer
                .get("port")
                .and_then(parse_u64)
                .unwrap_or(36988) as u16;
            let address = format!("{ip}:{port}");
            let entry = ExplorerPeerEntry {
                id: peer.get("id").and_then(parse_u64).unwrap_or(0),
                address: address.clone(),
                ip,
                port,
                subversion: subversion.clone(),
                protocol_version,
                connected_on_explorer: peer
                    .get("connected")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                last_seen: peer
                    .get("lastSeen")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
            };
            by_address.insert(address, entry);
        }
    }

    let mut peers: Vec<ExplorerPeerEntry> = by_address.into_values().collect();
    peers.sort_by(|a, b| {
        b.connected_on_explorer
            .cmp(&a.connected_on_explorer)
            .then_with(|| a.address.cmp(&b.address))
    });

    write_peers_cache(peers.clone()).await;
    Ok(peers)
}

pub async fn fetch_blocks(limit: u32) -> AppResult<Vec<ExplorerBlock>> {
    let limit = limit.clamp(1, 100);
    let blocks = if let Some(cached) = read_blocks_cache().await {
        cached
    } else {
        let client = http_client()?;
        let url = format!("{EXPLORER_REST}/block?limit=100");
        let value = get_json(&client, &url).await?;
        let arr = value
            .as_array()
            .ok_or_else(|| AppError::other("blocks response is not an array"))?;

        let fetched: Vec<ExplorerBlock> = arr
            .iter()
            .filter_map(|item| {
                Some(ExplorerBlock {
                    id: parse_u64(item.get("id")?)?,
                    hash: item.get("hash")?.as_str()?.to_string(),
                    height: parse_u64(item.get("height")?)?,
                    time: parse_u64(item.get("time")?)?,
                    mint: item
                        .get("mint")
                        .and_then(|v| v.as_str().map(str::to_string)),
                    difficulty: item
                        .get("difficulty")
                        .and_then(|v| v.as_str().map(str::to_string)),
                    n_tx: item.get("nTx").and_then(parse_u64),
                    miner_address: item
                        .get("miner")
                        .and_then(|m| m.get("address"))
                        .and_then(|v| v.as_str().map(str::to_string)),
                    size: item
                        .get("strippedsize")
                        .and_then(parse_u64)
                        .or_else(|| item.get("size").and_then(parse_u64)),
                    output_total: item
                        .get("outputT")
                        .and_then(|v| v.as_str().map(str::to_string))
                        .or_else(|| {
                            item.get("mint")
                                .and_then(|v| v.as_str().map(str::to_string))
                        }),
                    output_count: item.get("outputC").and_then(parse_u64),
                })
            })
            .collect();

        write_blocks_cache(fetched.clone()).await;
        fetched
    };

    Ok(blocks.into_iter().take(limit as usize).collect())
}

pub async fn fetch_transactions(limit: u32) -> AppResult<Vec<ExplorerTransaction>> {
    let limit = limit.clamp(1, 100);
    if let Some(cached) = read_transactions_cache().await {
        return Ok(cached);
    }

    let client = http_client()?;
    let url = format!("{EXPLORER_REST}/transaction?limit={limit}");
    let value = get_json(&client, &url).await?;
    let arr = value
        .as_array()
        .ok_or_else(|| AppError::other("transactions response is not an array"))?;

    let txs: Vec<ExplorerTransaction> = arr
        .iter()
        .filter_map(|item| {
            let block = item.get("blocks").and_then(|b| b.as_array()).and_then(|a| a.first());
            Some(ExplorerTransaction {
                id: parse_u64(item.get("id")?)?,
                txid: item.get("txid")?.as_str()?.to_string(),
                time: parse_u64(item.get("time")?)?,
                fee: item.get("fee").and_then(|v| v.as_str().map(str::to_string)),
                output_total: item
                    .get("outputT")
                    .and_then(|v| v.as_str().map(str::to_string)),
                block_height: block.and_then(|b| b.get("height")).and_then(parse_u64),
                block_hash: block
                    .and_then(|b| b.get("hash"))
                    .and_then(|v| v.as_str().map(str::to_string)),
            })
        })
        .collect();

    write_transactions_cache(txs.clone()).await;
    Ok(txs)
}

pub async fn fetch_extraction(limit: u32) -> AppResult<Vec<ExplorerExtractionEntry>> {
    let limit = limit.clamp(1, 100);
    if let Some(cached) = read_extraction_cache().await {
        return Ok(cached);
    }

    let client = http_client()?;
    let url = format!("{EXPLORER_REST}/extraction?limit={limit}");
    let value = get_json(&client, &url).await?;
    let arr = value
        .as_array()
        .ok_or_else(|| AppError::other("extraction response is not an array"))?;

    let entries: Vec<ExplorerExtractionEntry> = arr
        .iter()
        .filter_map(|item| {
            Some(ExplorerExtractionEntry {
                rank: item
                    .get("rank")
                    .and_then(|v| v.as_str().map(str::to_string)),
                address: item.get("address")?.as_str()?.to_string(),
                count: item
                    .get("count")
                    .and_then(|v| v.as_str().map(str::to_string)),
            })
        })
        .collect();

    write_extraction_cache(entries.clone()).await;
    Ok(entries)
}

pub async fn fetch_chain_tips() -> AppResult<Vec<ExplorerChainTip>> {
    if let Some(cached) = read_chain_cache().await {
        return Ok(cached);
    }

    let client = http_client()?;
    let url = format!("{EXPLORER_REST}/chain");
    let value = get_json(&client, &url).await?;
    let arr = value
        .as_array()
        .ok_or_else(|| AppError::other("chain response is not an array"))?;

    let mut tips: Vec<ExplorerChainTip> = arr
        .iter()
        .filter_map(|item| {
            Some(ExplorerChainTip {
                id: parse_u64(item.get("id")?)?,
                height: parse_u64(item.get("height")?)?,
                hash: item.get("hash")?.as_str()?.to_string(),
                branchlen: parse_u64(item.get("branchlen")?).unwrap_or(0),
                status_name: item
                    .get("status")
                    .and_then(|s| s.get("name"))
                    .and_then(|v| v.as_str().map(str::to_string)),
            })
        })
        .collect();

    tips.sort_by(|a, b| b.height.cmp(&a.height).then(b.id.cmp(&a.id)));

    write_chain_cache(tips.clone()).await;
    Ok(tips)
}

async fn read_stats_cache() -> Option<ExplorerStats> {
    let guard = CACHE.lock().await;
    guard
        .stats
        .as_ref()
        .filter(|e| e.at.elapsed() < CACHE_TTL)
        .map(|e| e.value.clone())
}

async fn write_stats_cache(stats: ExplorerStats) {
    let mut guard = CACHE.lock().await;
    guard.stats = Some(TimedEntry {
        at: Instant::now(),
        value: stats,
    });
}

async fn read_blocks_cache() -> Option<Vec<ExplorerBlock>> {
    let guard = CACHE.lock().await;
    guard
        .blocks
        .as_ref()
        .filter(|e| e.at.elapsed() < CACHE_TTL)
        .map(|e| e.value.clone())
}

async fn write_blocks_cache(blocks: Vec<ExplorerBlock>) {
    let mut guard = CACHE.lock().await;
    guard.blocks = Some(TimedEntry {
        at: Instant::now(),
        value: blocks,
    });
}

async fn read_transactions_cache() -> Option<Vec<ExplorerTransaction>> {
    let guard = CACHE.lock().await;
    guard
        .transactions
        .as_ref()
        .filter(|e| e.at.elapsed() < CACHE_TTL)
        .map(|e| e.value.clone())
}

async fn write_transactions_cache(txs: Vec<ExplorerTransaction>) {
    let mut guard = CACHE.lock().await;
    guard.transactions = Some(TimedEntry {
        at: Instant::now(),
        value: txs,
    });
}

async fn read_extraction_cache() -> Option<Vec<ExplorerExtractionEntry>> {
    let guard = CACHE.lock().await;
    guard
        .extraction
        .as_ref()
        .filter(|e| e.at.elapsed() < CACHE_TTL)
        .map(|e| e.value.clone())
}

async fn write_extraction_cache(entries: Vec<ExplorerExtractionEntry>) {
    let mut guard = CACHE.lock().await;
    guard.extraction = Some(TimedEntry {
        at: Instant::now(),
        value: entries,
    });
}

async fn read_chain_cache() -> Option<Vec<ExplorerChainTip>> {
    let guard = CACHE.lock().await;
    guard
        .chain_tips
        .as_ref()
        .filter(|e| e.at.elapsed() < CACHE_TTL)
        .map(|e| e.value.clone())
}

async fn write_chain_cache(tips: Vec<ExplorerChainTip>) {
    let mut guard = CACHE.lock().await;
    guard.chain_tips = Some(TimedEntry {
        at: Instant::now(),
        value: tips,
    });
}

async fn read_peers_cache() -> Option<Vec<ExplorerPeerEntry>> {
    let guard = CACHE.lock().await;
    guard
        .peers
        .as_ref()
        .filter(|e| e.at.elapsed() < PEERS_CACHE_TTL)
        .map(|e| e.value.clone())
}

async fn write_peers_cache(peers: Vec<ExplorerPeerEntry>) {
    let mut guard = CACHE.lock().await;
    guard.peers = Some(TimedEntry {
        at: Instant::now(),
        value: peers,
    });
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
