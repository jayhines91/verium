use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::coin_profile::{CoinId, CoinTarget, NetworkMode};
use crate::error::{AppError, AppResult};
use crate::node::rpc_auth::restrict_conf_permissions;
use crate::node::snapshot::is_wsl_unc_path;
use crate::prefs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    pub datadir: PathBuf,
    pub rpc_host: String,
    pub rpc_port: u16,
    pub chain: String,
    #[serde(default)]
    pub rpc_user: Option<String>,
    #[serde(skip_serializing, default)]
    pub rpc_password: Option<String>,
    #[serde(default)]
    pub rpc_password_set: bool,
    #[serde(default)]
    pub cookie_path: Option<PathBuf>,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        default_config_for_coin(CoinId::Verium)
    }
}

pub fn default_config_for_coin(coin: CoinId) -> DaemonConfig {
    default_config_for_target(CoinTarget::mainnet(coin))
}

/// Build a default DaemonConfig for a (coin, network) pair. Binarytest
/// targets use distinct ports / datadirs so they do not collide with mainnet.
pub fn default_config_for_target(target: CoinTarget) -> DaemonConfig {
    let datadir = target.datadir();
    let chain = match target.network {
        NetworkMode::Mainnet => target.coin.default_network_chain().to_string(),
        NetworkMode::BinaryTest => match target.coin {
            CoinId::Verium => "binarytest-verium".to_string(),
            CoinId::Vericoin => "binarytest-vericoin".to_string(),
        },
    };
    let mut cfg = DaemonConfig {
        datadir,
        rpc_host: "127.0.0.1".to_string(),
        rpc_port: target.rpc_port(),
        chain,
        rpc_user: None,
        rpc_password: None,
        rpc_password_set: false,
        cookie_path: None,
    };
    cfg.cookie_path = Some(chain_datadir(target.coin, &cfg).join(".cookie"));
    cfg
}

pub fn default_datadir(coin: CoinId) -> PathBuf {
    coin.default_datadir()
}

pub fn app_config_base() -> PathBuf {
    let base = dirs::config_dir()
        .or_else(dirs::data_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Vericonomy").join("desktop-app")
}

pub fn migrate_legacy_configs() -> AppResult<()> {
    let legacy_daemon = app_config_base()
        .parent()
        .map(|p| p.join("Verium").join("desktop-app").join("daemon.json"));
    let legacy_addressbook = app_config_base()
        .parent()
        .map(|p| p.join("Verium").join("desktop-app").join("addressbook.json"));
    if let Some(legacy) = legacy_daemon {
        let target = app_daemon_config_path(CoinId::Verium);
        if legacy.exists() && !target.exists() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&legacy, &target)?;
            tracing::info!("migrated legacy daemon.json to {}", target.display());
        }
    }
    if let Some(legacy) = legacy_addressbook {
        let target = app_addressbook_path(CoinId::Verium);
        if legacy.exists() && !target.exists() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&legacy, &target)?;
            tracing::info!("migrated legacy addressbook.json to {}", target.display());
        }
    }
    Ok(())
}

/// App-level daemon settings persisted between wallet restarts (no secrets on disk).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedDaemonConfig {
    pub datadir: PathBuf,
    pub rpc_host: String,
    pub rpc_port: u16,
    pub chain: String,
    #[serde(default)]
    pub rpc_user: Option<String>,
}

pub fn app_daemon_config_path(coin: CoinId) -> PathBuf {
    app_config_base().join(format!("daemon-{}.json", coin.as_str()))
}

pub fn app_addressbook_path(coin: CoinId) -> PathBuf {
    app_config_base().join(format!("addressbook-{}.json", coin.as_str()))
}

pub fn save_app_daemon_config(coin: CoinId, cfg: &DaemonConfig) -> AppResult<()> {
    let saved = SavedDaemonConfig {
        datadir: cfg.datadir.clone(),
        rpc_host: cfg.rpc_host.clone(),
        rpc_port: cfg.rpc_port,
        chain: cfg.chain.clone(),
        rpc_user: cfg.rpc_user.clone(),
    };
    let path = app_daemon_config_path(coin);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(&saved)?;
    fs::write(&path, json)?;
    tracing::info!("saved daemon config to {}", path.display());
    Ok(())
}

fn load_saved_daemon_config(coin: CoinId) -> AppResult<Option<SavedDaemonConfig>> {
    let path = app_daemon_config_path(coin);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)?;
    match serde_json::from_str::<SavedDaemonConfig>(&raw) {
        Ok(saved) => Ok(Some(saved)),
        Err(e) => {
            tracing::warn!("ignoring corrupt daemon.json: {e}");
            Ok(None)
        }
    }
}

fn config_from_saved(saved: SavedDaemonConfig) -> DaemonConfig {
    DaemonConfig {
        datadir: saved.datadir,
        rpc_host: saved.rpc_host,
        rpc_port: saved.rpc_port,
        chain: saved.chain,
        rpc_user: saved.rpc_user,
        rpc_password: None,
        rpc_password_set: false,
        cookie_path: None,
    }
}

pub fn load_or_default_config(coin: CoinId) -> AppResult<DaemonConfig> {
    let prefs = tauri::async_runtime::block_on(prefs::load()).unwrap_or_default();
    load_config_for_network(coin, prefs.network_mode)
}

/// Resolve daemon settings for a coin on a specific network mode. Uses the
/// saved daemon-*.json when its chain matches the requested mode; otherwise
/// returns fresh defaults for that network (binarytest ports/datadirs).
pub fn load_config_for_network(coin: CoinId, mode: NetworkMode) -> AppResult<DaemonConfig> {
    let _ = migrate_legacy_configs();
    let want_binarytest = mode.is_test();
    let mut cfg = if let Some(saved) = load_saved_daemon_config(coin)? {
        let saved_binarytest = saved.chain.starts_with("binarytest");
        if saved_binarytest == want_binarytest {
            config_from_saved(saved)
        } else {
            default_config_for_target(CoinTarget::new(coin, mode))
        }
    } else {
        default_config_for_target(CoinTarget::new(coin, mode))
    };
    if is_wsl_unc_path(&cfg.datadir) {
        tracing::info!(
            "unsupported WSL datadir — using native default instead of {}",
            cfg.datadir.display()
        );
        cfg.datadir = default_config_for_target(CoinTarget::new(coin, mode)).datadir;
    }
    refresh_config_paths(coin, &mut cfg)?;
    Ok(cfg)
}

/// Ensures the data directory exists and that verium.conf carries an RPC login
/// the desktop app can authenticate with. Safe to call on every launch — only
/// writes when something is missing.
pub fn ensure_first_run_config(coin: CoinId, cfg: &mut DaemonConfig) -> AppResult<bool> {
    fs::create_dir_all(&cfg.datadir)?;
    fs::create_dir_all(chain_datadir(coin, cfg))?;
    refresh_config_paths(coin, cfg)?;

    let diag = rpc_auth_diagnostics(coin, cfg);
    let needs_creds = !diag.rpc_user_in_conf || !diag.rpc_password_in_conf;
    if !needs_creds {
        return Ok(false);
    }

    let user = cfg
        .rpc_user
        .clone()
        .filter(|u| !u.is_empty())
        .unwrap_or_else(generate_rpc_user);
    let password = generate_rpc_password();
    let overrides = vec![
        ("server", "1".to_string()),
        ("rpcport", cfg.rpc_port.to_string()),
        ("rpcbind", cfg.rpc_host.clone()),
        ("rpcallowip", "127.0.0.1".to_string()),
        ("rpcuser", user.clone()),
        ("rpcpassword", password.clone()),
    ];
    write_node_conf_overrides(coin, &node_conf_dir(cfg), cfg, &overrides)?;
    cfg.rpc_user = Some(user);
    cfg.rpc_password = Some(password);
    refresh_config_paths(coin, cfg)?;
    save_app_daemon_config(coin, cfg)?;
    tracing::info!(
        "first-run: wrote rpc credentials to {}",
        node_conf_path(coin, cfg).display()
    );
    Ok(true)
}

/// Config section name the unified daemon expects in vericonomy.conf (matches
/// `SelectConfigNetwork` / `GetChainName()` — e.g. `binarytest-verium`, not `verium`).
pub fn daemon_config_section(coin: CoinId, cfg: &DaemonConfig) -> String {
    if cfg.chain.starts_with("binarytest-") {
        return cfg.chain.clone();
    }
    match (coin, cfg.chain.as_str()) {
        (CoinId::Verium, "main" | "verium") => "verium".to_string(),
        (CoinId::Vericoin, "vericoin" | "main") => "vericoin".to_string(),
        (_, chain) => chain.to_string(),
    }
}

/// Parent `-datadir` passed to veriumd. Node config (`vericonomy.conf`) lives here.
pub fn node_conf_dir(cfg: &DaemonConfig) -> PathBuf {
    cfg.datadir.clone()
}

/// Network-specific datadir where veriumd writes blocks, debug.log, and .cookie.
pub fn chain_datadir(coin: CoinId, cfg: &DaemonConfig) -> PathBuf {
    if verium_uses_legacy_flat(cfg) {
        return cfg.datadir.clone();
    }
    let mut p = cfg.datadir.clone();
    match cfg.chain.as_str() {
        "test" => p.push("testnet3"),
        "regtest" => p.push("regtest"),
        "binarytest-verium" | "binarytest-vericoin" => p.push(&cfg.chain),
        "main" | "verium" if coin == CoinId::Verium => p.push("verium"),
        "vericoin" | "main" if coin == CoinId::Vericoin => p.push("vericoin"),
        _ => {}
    }
    p
}

/// Verium mainnet uses the legacy flat layout (`…/Verium/blocks`), matching
/// verium-legacy / Verium-Qt and the official bootstrap CDN zips (no `-reindex`).
pub fn verium_uses_legacy_flat(cfg: &DaemonConfig) -> bool {
    cfg.chain == "main"
}

/// Remove corrupt block index LevelDB so veriumd can rebuild from existing blk*.dat via `-reindex`.
/// Preserves a populated `chainstate/` when present (typical after bootstrap import).
pub fn prepare_block_index_reindex(coin: CoinId, cfg: &DaemonConfig) -> AppResult<()> {
    let datadir = chain_datadir(coin, cfg);
    let index = datadir.join("blocks/index");
    if index.exists() {
        fs::remove_dir_all(&index)?;
        tracing::info!("chain repair: removed {}", index.display());
    }
    clear_datadir_stale_lock(&datadir);
    Ok(())
}

/// Remove corrupt LevelDB metadata so veriumd can rebuild from existing blk*.dat via `-reindex`.
/// When chainstate already looks complete, only the block index is cleared.
pub fn prepare_chain_for_reindex(coin: CoinId, cfg: &DaemonConfig) -> AppResult<()> {
    let datadir = chain_datadir(coin, cfg);
    let chainstate = datadir.join("chainstate");
    let preserve_chainstate = chainstate_bytes(&chainstate) >= 1_000_000;
    if preserve_chainstate {
        prepare_block_index_reindex(coin, cfg)?;
        tracing::info!(
            "chain repair: preserving chainstate ({} bytes)",
            chainstate_bytes(&chainstate)
        );
        return Ok(());
    }
    for sub in ["blocks/index", "chainstate"] {
        let path = datadir.join(sub);
        if path.exists() {
            fs::remove_dir_all(&path)?;
            tracing::info!("chain repair: removed {}", path.display());
        }
    }
    clear_datadir_stale_lock(&datadir);
    Ok(())
}

fn clear_datadir_stale_lock(datadir: &Path) {
    let lock = datadir.join(".lock");
    if lock.is_file() {
        let _ = fs::remove_file(&lock);
        tracing::info!("chain repair: removed stale lock {}", lock.display());
    }
}

/// Pre-unified / mis-targeted bootstrap layouts stored `blocks/` and `chainstate/`
/// directly under the parent `-datadir` (`…/Verium/blocks`) instead of the
/// network subfolder veriumd actually uses (`…/Verium/verium/blocks`).
pub fn legacy_root_chain_dir(cfg: &DaemonConfig) -> PathBuf {
    cfg.datadir.clone()
}

/// Where bootstrap must extract `blocks/` and `chainstate/` so the running daemon reads them.
pub fn bootstrap_chain_datadir(coin: CoinId, cfg: &DaemonConfig) -> PathBuf {
    if coin == CoinId::Verium && verium_uses_legacy_flat(cfg) {
        legacy_root_chain_dir(cfg)
    } else if binary_supports_unified_subdir(coin, cfg) {
        chain_datadir(coin, cfg)
    } else {
        legacy_root_chain_dir(cfg)
    }
}

fn binary_supports_unified_subdir(coin: CoinId, cfg: &DaemonConfig) -> bool {
    use crate::daemon::{binary_supports_unified_chain_selector, detect_binary};
    detect_binary(coin)
        .path
        .as_ref()
        .map(|p| binary_supports_unified_chain_selector(std::path::Path::new(p), coin))
        .unwrap_or(false)
        && !(coin == CoinId::Verium && verium_uses_legacy_flat(cfg))
}

/// True when bootstrap/chain data under `…/verium/` is much larger than the legacy root
/// layout (`…/Verium/blocks`) and should be promoted before starting legacy veriumd.
pub fn legacy_subdir_chain_ahead(coin: CoinId, cfg: &DaemonConfig) -> bool {
    let root = legacy_root_chain_dir(cfg);
    let sub = chain_datadir(coin, cfg);
    if root == sub {
        return false;
    }
    let root_blocks = root.join("blocks");
    let root_chainstate = root.join("chainstate");
    let sub_blocks = sub.join("blocks");
    let sub_chainstate = sub.join("chainstate");
    if !chain_dir_has_snapshot(&sub_blocks, &sub_chainstate) {
        return false;
    }
    let sub_bytes = chain_snapshot_bytes(&sub_blocks, &sub_chainstate);
    let root_bytes = chain_snapshot_bytes(&root_blocks, &root_chainstate);
    let sub_cs_bytes = dir_size(&sub_chainstate);
    let sub_blk_bytes = dir_size(&sub_blocks);
    if sub_blocks.join("blk00000.dat").is_file()
        && sub_blk_bytes >= MIN_BOOTSTRAP_BLOCKS_BYTES
        && root_bytes + 50_000_000 < sub_blk_bytes
    {
        return true;
    }
    sub_bytes + 50_000_000 > root_bytes && sub_cs_bytes >= 1_000_000
}

/// Legacy veriumd reads `…/Verium/blocks`, but older wallet builds imported bootstrap into
/// `…/Verium/verium/blocks`. Move the larger subdir snapshot to the root before apply/restart.
pub fn promote_subdir_chain_data_for_legacy(coin: CoinId, cfg: &DaemonConfig) -> AppResult<bool> {
    let root = legacy_root_chain_dir(cfg);
    let sub = chain_datadir(coin, cfg);
    if root == sub {
        return Ok(false);
    }

    let root_blocks = root.join("blocks");
    let root_chainstate = root.join("chainstate");
    let sub_blocks = sub.join("blocks");
    let sub_chainstate = sub.join("chainstate");

    if !legacy_subdir_chain_ahead(coin, cfg) {
        return Ok(false);
    }

    fs::create_dir_all(&root)?;
    for name in ["blocks", "chainstate"] {
        let src = sub.join(name);
        if !src.exists() {
            continue;
        }
        if name == "chainstate" && chainstate_bytes(&src) < 1_000_000 {
            tracing::info!(
                "legacy chain promote ({}): skipping empty chainstate at {}",
                coin.as_str(),
                src.display()
            );
            continue;
        }
        let dst = root.join(name);
        if dst.exists() {
            fs::remove_dir_all(&dst)?;
        }
        fs::rename(&src, &dst)?;
        tracing::info!(
            "legacy chain promote ({}): moved {} -> {}",
            coin.as_str(),
            src.display(),
            dst.display()
        );
    }
    Ok(true)
}

fn dir_size(path: &Path) -> u64 {
    if !path.is_dir() {
        return 0;
    }
    let mut total = 0u64;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                total += p.metadata().map(|m| m.len()).unwrap_or(0);
            } else if p.is_dir() {
                total += dir_size(&p);
            }
        }
    }
    total
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> AppResult<()> {
    if !src.is_dir() {
        return Err(AppError::other(format!(
            "copy_dir_recursive: {} is not a directory",
            src.display()
        )));
    }
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn chain_dir_has_snapshot(blocks: &Path, chainstate: &Path) -> bool {
    blocks.is_dir()
        && chainstate.is_dir()
        && blocks.join("blk00000.dat").is_file()
        && chainstate.join("CURRENT").is_file()
}

fn chain_snapshot_bytes(blocks: &Path, chainstate: &Path) -> u64 {
    dir_size(blocks) + dir_size(chainstate)
}

/// Minimum chainstate size for a bootstrap archive to be considered complete.
const MIN_BOOTSTRAP_CHAINSTATE_BYTES: u64 = 5_000_000;
/// Minimum blocks/ payload for a bootstrap archive.
const MIN_BOOTSTRAP_BLOCKS_BYTES: u64 = 50_000_000;

pub fn chainstate_bytes(chainstate: &Path) -> u64 {
    dir_size(chainstate)
}

pub fn blocks_data_bytes(blocks: &Path) -> u64 {
    dir_size(blocks)
}

/// Validate extracted bootstrap staging before replacing live chain data.
pub fn validate_bootstrap_staging(staging: &Path) -> AppResult<()> {
    let blocks = staging.join("blocks");
    let chainstate = staging.join("chainstate");
    if !blocks.is_dir() || !chainstate.is_dir() {
        return Err(AppError::other(
            "Downloaded bootstrap zip did not contain blocks/ and chainstate/ directories.",
        ));
    }
    if !blocks.join("blk00000.dat").is_file() {
        return Err(AppError::other(
            "Bootstrap blocks/ is missing blk00000.dat — the archive may be corrupt.",
        ));
    }
    let cs = chainstate_bytes(&chainstate);
    if cs < MIN_BOOTSTRAP_CHAINSTATE_BYTES {
        return Err(AppError::other(format!(
            "Bootstrap chainstate/ is too small ({cs} bytes). \
             The archive may be corrupt, truncated, or still downloading."
        )));
    }
    let blk = blocks_data_bytes(&blocks);
    if blk < MIN_BOOTSTRAP_BLOCKS_BYTES {
        return Err(AppError::other(format!(
            "Bootstrap blocks/ is too small ({blk} bytes). \
             The archive may be corrupt, truncated, or still downloading."
        )));
    }
    Ok(())
}

/// `blocks/` has real data but `chainstate/` is empty — typical after interrupted bootstrap.
pub fn chain_snapshot_needs_reindex(datadir: &Path) -> bool {
    let blocks = datadir.join("blocks");
    let chainstate = datadir.join("chainstate");
    if !blocks.join("blk00000.dat").is_file() {
        return false;
    }
    blocks_data_bytes(&blocks) > 10_000_000 && chainstate_bytes(&chainstate) < 1_000_000
}

/// Unified bootstrap strips legacy `blocks/index`; veriumd must run with `-reindex` until the
/// index is rebuilt. Not used for Verium mainnet (legacy flat bootstrap keeps the index).
pub fn chain_index_needs_rebuild(datadir: &Path) -> bool {
    let blocks = datadir.join("blocks");
    if !blocks.join("blk00000.dat").is_file() {
        return false;
    }
    let blocks_bytes = blocks_data_bytes(&blocks);
    let cs_bytes = chainstate_bytes(&datadir.join("chainstate"));
    let index_bytes = chain_index_bytes(&blocks);
    blocks_bytes > 10_000_000 && cs_bytes > 1_000_000 && index_bytes < 500_000
}

fn chain_index_bytes(blocks: &Path) -> u64 {
    dir_size(&blocks.join("index"))
}

/// True when root-level blocks/chainstate should be moved into the unified chain subdir.
pub fn should_migrate_root_chain_data(coin: CoinId, cfg: &DaemonConfig) -> bool {
    let root = legacy_root_chain_dir(cfg);
    let target = chain_datadir(coin, cfg);
    if root == target {
        return false;
    }

    let root_blocks = root.join("blocks");
    let root_chainstate = root.join("chainstate");
    let target_blocks = target.join("blocks");
    let target_chainstate = target.join("chainstate");

    if root_blocks.join("blk00000.dat").is_file()
        && chainstate_bytes(&target_chainstate) < 1_000_000
        && blocks_data_bytes(&root_blocks) >= MIN_BOOTSTRAP_BLOCKS_BYTES
        && blocks_data_bytes(&root_blocks)
            > blocks_data_bytes(&target_blocks).saturating_add(10_000_000)
    {
        return true;
    }

    let root_index_bytes = chain_index_bytes(&root_blocks);
    let target_index_bytes = chain_index_bytes(&target_blocks);
    let root_cs_bytes = dir_size(&root_chainstate);
    let target_cs_bytes = dir_size(&target_chainstate);

    if target_blocks.join("blk00000.dat").is_file()
        && root_index_bytes > 1_000_000
        && target_index_bytes < 500_000
    {
        return true;
    }

    if target_blocks.join("blk00000.dat").is_file()
        && root_cs_bytes > 1_000_000
        && target_cs_bytes < 500_000
        && root_chainstate.is_dir()
    {
        return true;
    }

    if !chain_dir_has_snapshot(&root_blocks, &root_chainstate) {
        return false;
    }

    let root_bytes = chain_snapshot_bytes(&root_blocks, &root_chainstate);
    let target_bytes = chain_snapshot_bytes(&target_blocks, &target_chainstate);
    let target_has_chainstate = target_cs_bytes > 1_000_000;
    !(target_bytes + 50_000_000 >= root_bytes && target_bytes > 100_000_000 && target_has_chainstate)
}

/// Move root-level `blocks/` + `chainstate/` into the chain subdir veriumd reads.
pub fn migrate_legacy_root_chain_data(coin: CoinId, cfg: &DaemonConfig) -> AppResult<bool> {
    let root = legacy_root_chain_dir(cfg);
    let target = chain_datadir(coin, cfg);
    if root == target {
        return Ok(false);
    }

    let root_blocks = root.join("blocks");
    let root_chainstate = root.join("chainstate");
    let target_blocks = target.join("blocks");
    let target_chainstate = target.join("chainstate");
    let root_index_bytes = chain_index_bytes(&root_blocks);
    let target_index_bytes = chain_index_bytes(&target_blocks);
    let root_cs_bytes = dir_size(&root_chainstate);
    let target_cs_bytes = dir_size(&target_chainstate);
    let mut migrated = false;

    // Block files already under verium/ but blocks/index was wiped by a failed reindex
    // while a good index still exists at the datadir root.
    if target_blocks.join("blk00000.dat").is_file()
        && root_index_bytes > 1_000_000
        && target_index_bytes < 500_000
    {
        fs::create_dir_all(&target_blocks)?;
        let src_index = root_blocks.join("index");
        let dst_index = target_blocks.join("index");
        if dst_index.exists() {
            fs::remove_dir_all(&dst_index)?;
        }
        copy_dir_recursive(&src_index, &dst_index)?;
        tracing::info!(
            "legacy chain migrate ({}): copied blocks/index {} -> {} ({} MB)",
            coin.as_str(),
            src_index.display(),
            dst_index.display(),
            root_index_bytes / 1_000_000
        );
        migrated = true;
    }

    // Chainstate missing under verium/ while bootstrap snapshot still sits at root.
    if target_blocks.join("blk00000.dat").is_file()
        && root_cs_bytes > 1_000_000
        && target_cs_bytes < 500_000
        && root_chainstate.is_dir()
    {
        fs::create_dir_all(&target)?;
        if target_chainstate.exists() {
            fs::remove_dir_all(&target_chainstate)?;
        }
        fs::rename(&root_chainstate, &target_chainstate)?;
        tracing::info!(
            "legacy chain migrate ({}): moved chainstate into {} ({} MB)",
            coin.as_str(),
            target_chainstate.display(),
            root_cs_bytes / 1_000_000
        );
        migrated = true;
    }

    if migrated {
        return Ok(true);
    }

    if !chain_dir_has_snapshot(&root_blocks, &root_chainstate) {
        return Ok(false);
    }

    let root_bytes = chain_snapshot_bytes(&root_blocks, &root_chainstate);
    let target_bytes = chain_snapshot_bytes(&target_blocks, &target_chainstate);
    // Prefer the larger snapshot. Require meaningful chainstate, not blocks alone.
    let target_has_chainstate = target_cs_bytes > 1_000_000;
    if target_bytes + 50_000_000 >= root_bytes && target_bytes > 100_000_000 && target_has_chainstate {
        tracing::info!(
            "legacy chain migrate ({}): keeping existing data under {} ({} MB)",
            coin.as_str(),
            target.display(),
            target_bytes / 1_000_000
        );
        return Ok(false);
    }

    fs::create_dir_all(&target)?;
    for name in ["blocks", "chainstate"] {
        let src = root.join(name);
        let dst = target.join(name);
        if dst.exists() {
            fs::remove_dir_all(&dst)?;
        }
        fs::rename(&src, &dst)?;
        tracing::info!(
            "legacy chain migrate ({}): moved {} -> {}",
            coin.as_str(),
            src.display(),
            dst.display()
        );
    }
    Ok(true)
}

/// When legacy `blocks/` at the datadir root is larger than `verium/blocks/` and the
/// unified chainstate is empty, replace the broken copy under `verium/`.
pub fn recover_split_chain_layout(coin: CoinId, cfg: &DaemonConfig) -> AppResult<bool> {
    let root = legacy_root_chain_dir(cfg);
    let target = chain_datadir(coin, cfg);
    if root == target {
        return Ok(false);
    }

    let root_blocks = root.join("blocks");
    let root_chainstate = root.join("chainstate");
    let target_blocks = target.join("blocks");
    let target_chainstate = target.join("chainstate");

    if !root_blocks.join("blk00000.dat").is_file() {
        return Ok(false);
    }
    if chainstate_bytes(&target_chainstate) > 1_000_000 {
        return Ok(false);
    }

    let root_bytes = blocks_data_bytes(&root_blocks);
    let root_cs_bytes = chainstate_bytes(&root_chainstate);
    let target_bytes = blocks_data_bytes(&target_blocks);
    if root_bytes < MIN_BOOTSTRAP_BLOCKS_BYTES {
        return Ok(false);
    }
    if target_bytes > root_bytes.saturating_add(10_000_000) {
        return Ok(false);
    }

    fs::create_dir_all(&target)?;
    let stamp = chrono::Utc::now().format("%Y%m%d%H%M%S");
    if target_blocks.exists() {
        let backup = target.join(format!("blocks.recovery-{stamp}"));
        if backup.exists() {
            fs::remove_dir_all(&backup)?;
        }
        fs::rename(&target_blocks, &backup)?;
        tracing::info!(
            "chain recovery ({}): backed up {} -> {}",
            coin.as_str(),
            target_blocks.display(),
            backup.display()
        );
    }
    if target_chainstate.exists() {
        fs::remove_dir_all(&target_chainstate)?;
    }
    let mut recovered = false;
    if root_blocks.exists() {
        fs::rename(&root_blocks, &target_blocks)?;
        tracing::info!(
            "chain recovery ({}): promoted legacy {} -> {} ({} MB blocks)",
            coin.as_str(),
            root_blocks.display(),
            target_blocks.display(),
            root_bytes / 1_000_000
        );
        recovered = true;
    }
    if root_chainstate.is_dir() && root_cs_bytes >= MIN_BOOTSTRAP_CHAINSTATE_BYTES {
        fs::rename(&root_chainstate, &target_chainstate)?;
        tracing::info!(
            "chain recovery ({}): promoted legacy {} -> {} ({} MB chainstate)",
            coin.as_str(),
            root_chainstate.display(),
            target_chainstate.display(),
            root_cs_bytes / 1_000_000
        );
        recovered = true;
    }
    Ok(recovered)
}

/// Recommended `-dbcache` (MiB) for faster initial sync on typical desktop hardware.
pub fn recommended_dbcache_mib() -> u64 {
    2048
}

/// veriumd settings that improve block download and validation throughput during IBD.
pub fn sync_performance_overrides() -> Vec<(&'static str, String)> {
    vec![
        ("dbcache", recommended_dbcache_mib().to_string()),
        ("maxconnections", "32".to_string()),
        ("maxuploadtarget", "0".to_string()),
    ]
}

/// Ensure `vericonomy.conf` has a complete `[verium]` / `[vericoin]` section that
/// matches what the wallet passes on the CLI (server, rpcbind, checklevel, creds).
pub fn ensure_daemon_conf_complete(coin: CoinId, cfg: &mut DaemonConfig) -> AppResult<()> {
    refresh_config_paths(coin, cfg)?;
    let diag = rpc_auth_diagnostics(coin, cfg);
    let need_creds = !diag.rpc_user_in_conf || !diag.rpc_password_in_conf;
    let mut overrides = vec![
        ("server", "1".to_string()),
        ("rpcport", cfg.rpc_port.to_string()),
        ("rpcbind", cfg.rpc_host.clone()),
        ("rpcallowip", "127.0.0.1".to_string()),
        ("checklevel", "0".to_string()),
    ];
    overrides.extend(sync_performance_overrides());
    if need_creds {
        let user = cfg
            .rpc_user
            .clone()
            .filter(|u| !u.is_empty())
            .unwrap_or_else(generate_rpc_user);
        let pass = cfg
            .rpc_password
            .clone()
            .filter(|p| !p.is_empty())
            .unwrap_or_else(generate_rpc_password);
        overrides.push(("rpcuser", user.clone()));
        overrides.push(("rpcpassword", pass.clone()));
        cfg.rpc_user = Some(user);
        cfg.rpc_password = Some(pass);
    }
    write_node_conf_overrides(coin, &node_conf_dir(cfg), cfg, &overrides)?;
    refresh_config_paths(coin, cfg)?;
    Ok(())
}

/// When older wallet builds wrote `verium.conf` at the datadir root, merge RPC
/// settings into `vericonomy.conf` under the correct `[verium]` / `[vericoin]` section.
fn migrate_legacy_verium_conf(coin: CoinId, cfg: &DaemonConfig) -> AppResult<()> {
    let root = node_conf_dir(cfg);
    fs::create_dir_all(&root)?;
    let legacy = root.join("verium.conf");
    if !legacy.is_file() {
        return Ok(());
    }
    let content = fs::read_to_string(&legacy)?;
    let mut rpc_user: Option<String> = None;
    let mut rpc_password: Option<String> = None;
    let mut rpc_port: Option<u16> = None;
    for raw in content.lines() {
        let line = strip_comment(raw).trim();
        if let Some((key, value)) = line.split_once('=') {
            match key.trim() {
                "rpcuser" => rpc_user = Some(value.trim().to_string()),
                "rpcpassword" => rpc_password = Some(value.trim().to_string()),
                "rpcport" => rpc_port = value.trim().parse().ok(),
                _ => {}
            }
        }
    }
    let mut overrides = Vec::new();
    if let Some(u) = rpc_user {
        overrides.push(("rpcuser", u));
    }
    if let Some(p) = rpc_password {
        overrides.push(("rpcpassword", p));
    }
    if let Some(port) = rpc_port {
        overrides.push(("rpcport", port.to_string()));
    }
    if overrides.is_empty() {
        return Ok(());
    }
    write_node_conf_overrides(coin, &root, cfg, &overrides)?;
    let migrated = root.join("verium.conf.migrated");
    if !migrated.exists() {
        let _ = fs::rename(&legacy, &migrated);
        tracing::info!(
            "migrated legacy verium.conf into {}",
            node_conf_path(coin, cfg).display()
        );
    } else if legacy.is_file() {
        let _ = fs::remove_file(&legacy);
        tracing::info!(
            "removed stale legacy verium.conf after prior migration to {}",
            node_conf_path(coin, cfg).display()
        );
    }
    Ok(())
}

/// Matches veriumd's `GetWalletDir()` — uses `<datadir>/wallets` when that folder exists.
fn wallet_dir(coin: CoinId, cfg: &DaemonConfig) -> PathBuf {
    let base = chain_datadir(coin, cfg);
    let wallets = base.join("wallets");
    if wallets.is_dir() {
        wallets
    } else {
        base
    }
}

/// Locate the active wallet file on disk (legacy root or `wallets/` layout).
pub fn resolve_wallet_dat_path(coin: CoinId, cfg: &DaemonConfig) -> Option<PathBuf> {
    let base = chain_datadir(coin, cfg);
    let candidates = [
        base.join("wallet.dat"),
        base.join("wallets").join("wallet.dat"),
    ];
    for path in candidates {
        if path.is_file() {
            return Some(path);
        }
    }
    let wallets_root = base.join("wallets");
    if wallets_root.is_dir() {
        if let Ok(entries) = fs::read_dir(&wallets_root) {
            for entry in entries.flatten() {
                let candidate = entry.path().join("wallet.dat");
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

pub fn wallet_dat_path(coin: CoinId, cfg: &DaemonConfig) -> PathBuf {
    resolve_wallet_dat_path(coin, cfg)
        .unwrap_or_else(|| wallet_dir(coin, cfg).join("wallet.dat"))
}

pub fn wallet_dat_exists(coin: CoinId, cfg: &DaemonConfig) -> bool {
    resolve_wallet_dat_path(coin, cfg).is_some()
}

/// `<datadir>/backups` — default folder for wallet exports (never the live wallet path).
pub fn wallet_backup_dir(coin: CoinId, cfg: &DaemonConfig) -> AppResult<PathBuf> {
    let dir = chain_datadir(coin, cfg).join("backups");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn default_wallet_backup_filename(coin: CoinId) -> String {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    format!("{}-wallet-{stamp}.dat", coin.as_str())
}

pub fn suggested_wallet_backup_path(coin: CoinId, cfg: &DaemonConfig) -> AppResult<PathBuf> {
    Ok(wallet_backup_dir(coin, cfg)?.join(default_wallet_backup_filename(coin)))
}

/// Absolute path string for `backupwallet` (forward slashes work on Windows too).
pub fn path_for_veriumd_rpc(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// True when `dest` would overwrite the loaded wallet file.
pub fn is_live_wallet_destination(coin: CoinId, cfg: &DaemonConfig, dest: &Path) -> bool {
    let Some(live) = resolve_wallet_dat_path(coin, cfg) else {
        return false;
    };
    let dest_key = dest.to_string_lossy().to_ascii_lowercase();
    let live_key = live.to_string_lossy().to_ascii_lowercase();
    dest_key == live_key
}

pub fn apply_partial_to_config(base: &DaemonConfig, partial: &PartialDaemonConfig) -> DaemonConfig {
    let mut cfg = base.clone();
    if let Some(d) = partial.datadir.as_ref() {
        cfg.datadir = PathBuf::from(d);
    }
    if let Some(h) = partial.rpc_host.as_ref() {
        cfg.rpc_host = h.clone();
    }
    if let Some(p) = partial.rpc_port {
        cfg.rpc_port = p;
    }
    if let Some(c) = partial.chain.as_ref() {
        cfg.chain = c.clone();
    }
    if let Some(u) = partial.rpc_user.as_ref() {
        cfg.rpc_user = if u.is_empty() { None } else { Some(u.clone()) };
    }
    if let Some(p) = partial.rpc_password.as_ref().filter(|p| !p.is_empty()) {
        cfg.rpc_password = Some(p.clone());
    }
    cfg
}

#[derive(Debug, Deserialize, Default)]
pub struct PartialDaemonConfig {
    pub datadir: Option<String>,
    pub rpc_host: Option<String>,
    pub rpc_port: Option<u16>,
    pub chain: Option<String>,
    pub rpc_user: Option<String>,
    pub rpc_password: Option<String>,
}

pub fn parse_node_conf_into(coin: CoinId, datadir: &Path, cfg: &mut DaemonConfig) -> AppResult<()> {
    let path = datadir.join(coin.conf_filename());
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path)?;
    let mut current_section: Option<String> = None;
    let active_section = Some(daemon_config_section(coin, cfg));
    let active_chain = cfg.chain.clone();
    for raw in content.lines() {
        let line = strip_comment(raw).trim().to_string();
        if line.is_empty() {
            continue;
        }
        if let Some(section) = line
            .strip_prefix('[')
            .and_then(|s| s.strip_suffix(']'))
            .map(|s| s.trim().to_string())
        {
            current_section = Some(section);
            continue;
        }
        let in_active_section = match (&active_section, &current_section) {
            (Some(expected), Some(s)) => s == expected,
            (Some(_), None) => false,
            (None, None) => true,
            (None, Some(s)) => s == &active_chain,
        };
        if !in_active_section {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            let value = value.trim();
            match key {
                "rpcport" => {
                    cfg.rpc_port = value.parse().map_err(|_| {
                        AppError::Config(format!("invalid rpcport: {value}"))
                    })?;
                }
                "rpcbind" => {
                    let host = value.split(':').next().unwrap_or(value).to_string();
                    if !host.is_empty() {
                        cfg.rpc_host = host;
                    }
                }
                "rpcuser" => cfg.rpc_user = Some(value.to_string()),
                "rpcpassword" => cfg.rpc_password = Some(value.to_string()),
                "testnet" if value == "1" => cfg.chain = "test".to_string(),
                _ => {}
            }
        }
    }
    Ok(())
}

/// Backwards-compatible alias.
pub fn parse_verium_conf_into(datadir: &Path, cfg: &mut DaemonConfig) -> AppResult<()> {
    parse_node_conf_into(CoinId::Verium, datadir, cfg)
}

/// Read rpcuser/rpcpassword from disk for the active config section.
pub fn read_rpc_credentials_from_conf(
    coin: CoinId,
    cfg: &DaemonConfig,
) -> AppResult<Option<(String, String)>> {
    let path = node_conf_path(coin, cfg);
    if !path.exists() {
        return Ok(None);
    }
    let mut scratch = cfg.clone();
    parse_node_conf_into(coin, node_conf_dir(cfg).as_path(), &mut scratch)?;
    match (
        scratch.rpc_user.filter(|u| !u.is_empty()),
        scratch.rpc_password.filter(|p| !p.is_empty()),
    ) {
        (Some(user), Some(pass)) => Ok(Some((user, pass))),
        _ => Ok(None),
    }
}

/// Overwrite in-memory RPC login from `vericonomy.conf` so spawn and RPC agree.
pub fn sync_cfg_rpc_credentials_from_conf(coin: CoinId, cfg: &mut DaemonConfig) -> AppResult<()> {
    refresh_config_paths(coin, cfg)?;
    if let Some((user, pass)) = read_rpc_credentials_from_conf(coin, cfg)? {
        cfg.rpc_user = Some(user);
        cfg.rpc_password = Some(pass);
        cfg.rpc_password_set = true;
    }
    Ok(())
}

fn strip_comment(line: &str) -> &str {
    if let Some(idx) = line.find('#') {
        &line[..idx]
    } else {
        line
    }
}

/// Older wallet builds wrote `[verium]` / `[vericoin]` sections; the unified
/// daemon on binarytest expects `[binarytest-verium]` / `[binarytest-vericoin]`.
fn migrate_conf_section(coin: CoinId, cfg: &DaemonConfig) -> AppResult<()> {
    let expected = daemon_config_section(coin, cfg);
    let legacy = match coin {
        CoinId::Verium => "verium",
        CoinId::Vericoin => "vericoin",
    };
    if expected == legacy {
        return Ok(());
    }
    let path = node_conf_path(coin, cfg);
    if !path.is_file() {
        return Ok(());
    }
    let content = fs::read_to_string(&path)?;
    let has_expected = content.lines().any(|l| {
        l.trim()
            .eq_ignore_ascii_case(format!("[{expected}]").as_str())
    });
    if has_expected {
        return Ok(());
    }
    let mut overrides: Vec<(&str, String)> = Vec::new();
    let mut in_legacy = false;
    for raw in content.lines() {
        let line = strip_comment(raw).trim();
        if line.starts_with('[') && line.ends_with(']') {
            let name = line.trim_start_matches('[').trim_end_matches(']').trim();
            in_legacy = name.eq_ignore_ascii_case(legacy);
            continue;
        }
        if !in_legacy {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            overrides.push((key.trim(), value.trim().to_string()));
        }
    }
    if overrides.is_empty() {
        return Ok(());
    }
    write_node_conf_overrides(coin, &node_conf_dir(cfg), cfg, &overrides)?;
    tracing::info!(
        "migrated [{legacy}] RPC settings into [{expected}] in {}",
        path.display()
    );
    Ok(())
}

/// veriumd writes `.cookie` under the chain subfolder (unified builds) or the
/// parent `-datadir` (legacy verium-only v1.x). Check both.
pub fn resolve_cookie_path(coin: CoinId, cfg: &DaemonConfig) -> Option<PathBuf> {
    let chain_cookie = chain_datadir(coin, cfg).join(".cookie");
    if chain_cookie.is_file() {
        return Some(chain_cookie);
    }
    let root_cookie = cfg.datadir.join(".cookie");
    if root_cookie.is_file() {
        return Some(root_cookie);
    }
    None
}

/// One-time migration reads legacy flat `verium.conf` into `vericonomy.conf` sections.
/// Ongoing writes go to `vericonomy.conf` only — see `migrate_legacy_verium_conf`.
pub fn refresh_config_paths(coin: CoinId, cfg: &mut DaemonConfig) -> AppResult<()> {
    migrate_legacy_verium_conf(coin, cfg)?;
    migrate_conf_section(coin, cfg)?;
    let conf_dir = node_conf_dir(cfg);
    parse_node_conf_into(coin, &conf_dir, cfg)?;
    cfg.cookie_path = resolve_cookie_path(coin, cfg);
    cfg.rpc_password_set = cfg.rpc_password.is_some();
    Ok(())
}

pub fn generate_rpc_password() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

pub fn generate_rpc_user() -> String {
    format!("wallet_{}", &generate_rpc_password()[..8])
}

#[derive(Debug, Clone, Serialize)]
pub struct RpcAuthDiagnostics {
    pub conf_path: String,
    pub conf_exists: bool,
    pub rpc_user_in_conf: bool,
    pub rpc_password_in_conf: bool,
    pub cookie_present: bool,
    pub app_auth_method: String,
}

pub fn rpc_auth_diagnostics(coin: CoinId, cfg: &DaemonConfig) -> RpcAuthDiagnostics {
    let conf_path = node_conf_path(coin, cfg);
    let section = daemon_config_section(coin, cfg);
    let mut rpc_user_in_conf = false;
    let mut rpc_password_in_conf = false;
    if conf_path.exists() {
        if let Ok(content) = fs::read_to_string(&conf_path) {
            let mut current_section: Option<String> = None;
            for line in content.lines() {
                let line = strip_comment(line).trim();
                if let Some(name) = line
                    .strip_prefix('[')
                    .and_then(|s| s.strip_suffix(']'))
                    .map(str::trim)
                {
                    current_section = Some(name.to_string());
                    continue;
                }
                if current_section.as_deref() != Some(section.as_str()) {
                    continue;
                }
                if let Some((key, _)) = line.split_once('=') {
                    match key.trim() {
                        "rpcuser" => rpc_user_in_conf = true,
                        "rpcpassword" => rpc_password_in_conf = true,
                        _ => {}
                    }
                }
            }
        }
    }
    let cookie_present = resolve_cookie_path(coin, cfg).is_some();
    let app_auth_method = if rpc_password_in_conf && rpc_user_in_conf {
        "userpass".to_string()
    } else if cookie_present {
        "cookie".to_string()
    } else if cfg.rpc_user.is_some() && cfg.rpc_password.is_some() {
        "userpass".to_string()
    } else {
        "none".to_string()
    };
    RpcAuthDiagnostics {
        conf_path: conf_path.display().to_string(),
        conf_exists: conf_path.exists(),
        rpc_user_in_conf,
        rpc_password_in_conf,
        cookie_present,
        app_auth_method,
    }
}

pub fn write_node_conf_overrides(
    coin: CoinId,
    datadir: &Path,
    cfg: &DaemonConfig,
    overrides: &[(&str, String)],
) -> AppResult<()> {
    let path = datadir.join(coin.conf_filename());
    fs::create_dir_all(datadir)?;
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let backup = datadir.join(format!("{}.bak", coin.conf_filename()));
    if path.exists() {
        let _ = fs::copy(&path, &backup);
    }

    let section = daemon_config_section(coin, cfg);
    let mut lines: Vec<String> = existing.lines().map(|l| l.to_string()).collect();
    if !existing.contains('[') {
        lines.insert(0, format!("[{section}]"));
    }
    for (key, value) in overrides {
        let prefix = format!("{key}=");
        let comment_prefix = format!("#{key}=");
        let mut replaced = false;
        let mut in_section = false;
        for line in lines.iter_mut() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                let name = trimmed.trim_start_matches('[').trim_end_matches(']').trim();
                in_section = name == section;
                continue;
            }
            if !in_section {
                continue;
            }
            let trimmed = line.trim_start();
            if trimmed.starts_with(&prefix) || trimmed.starts_with(&comment_prefix) {
                *line = format!("{key}={value}");
                replaced = true;
                break;
            }
        }
        if !replaced {
            if let Some(idx) = lines.iter().position(|l| {
                l.trim()
                    .eq_ignore_ascii_case(format!("[{section}]").as_str())
            }) {
                lines.insert(idx + 1, format!("{key}={value}"));
            } else {
                lines.push(format!("[{section}]"));
                lines.push(format!("{key}={value}"));
            }
        }
    }
    let joined = lines.join("\n");
    fs::write(&path, joined)?;
    let _ = restrict_conf_permissions(&path);
    if overrides.iter().any(|(k, _)| *k == "rpcpassword") {
        let cookie = chain_datadir(coin, cfg).join(".cookie");
        if cookie.is_file() {
            let _ = fs::remove_file(&cookie);
            tracing::info!(
                "removed stale {} after writing rpcpassword to conf",
                cookie.display()
            );
        }
    }
    Ok(())
}

pub fn write_verium_conf_overrides(
    datadir: &Path,
    cfg: &DaemonConfig,
    overrides: &[(&str, String)],
) -> AppResult<()> {
    write_node_conf_overrides(CoinId::Verium, datadir, cfg, overrides)
}

pub fn node_conf_path(coin: CoinId, cfg: &DaemonConfig) -> PathBuf {
    node_conf_dir(cfg).join(coin.conf_filename())
}

pub fn node_conf_backup_path(coin: CoinId, cfg: &DaemonConfig) -> PathBuf {
    node_conf_dir(cfg).join(format!("{}.bak", coin.conf_filename()))
}

pub fn read_node_conf_file(coin: CoinId, cfg: &DaemonConfig) -> AppResult<String> {
    let path = node_conf_path(coin, cfg);
    if !path.exists() {
        return Ok(String::new());
    }
    Ok(fs::read_to_string(&path)?)
}

pub fn write_node_conf_file(coin: CoinId, cfg: &DaemonConfig, content: &str) -> AppResult<()> {
    fs::create_dir_all(node_conf_dir(cfg))?;
    let path = node_conf_path(coin, cfg);
    if path.exists() {
        let _ = fs::copy(&path, node_conf_backup_path(coin, cfg));
    }
    fs::write(&path, content)?;
    Ok(())
}

pub fn verium_conf_path(cfg: &DaemonConfig) -> PathBuf {
    node_conf_path(CoinId::Verium, cfg)
}

pub fn verium_conf_backup_path(cfg: &DaemonConfig) -> PathBuf {
    node_conf_backup_path(CoinId::Verium, cfg)
}

pub fn read_verium_conf_file(cfg: &DaemonConfig) -> AppResult<String> {
    read_node_conf_file(CoinId::Verium, cfg)
}

pub fn write_verium_conf_file(cfg: &DaemonConfig, content: &str) -> AppResult<()> {
    write_node_conf_file(CoinId::Verium, cfg, content)
}

/// Berkeley DB keeps environment files beside `wallet.dat`. After replacing the
/// wallet file, stale log/cache files must be removed or veriumd can load a mix
/// of old and new wallet state (wrong balances vs transaction list).
pub fn clear_wallet_bdb_environment(wallet_dat: &Path) -> AppResult<()> {
    let Some(parent) = wallet_dat.parent() else {
        return Ok(());
    };
    let db_dir = parent.join("database");
    if db_dir.is_dir() {
        fs::remove_dir_all(&db_dir)?;
        tracing::info!(
            "wallet restore: cleared Berkeley DB environment at {}",
            db_dir.display()
        );
    }
    let db_log = parent.join("db.log");
    if db_log.is_file() {
        fs::remove_file(&db_log)?;
        tracing::info!(
            "wallet restore: removed stale db.log at {}",
            db_log.display()
        );
    }
    Ok(())
}

#[cfg(test)]
mod config_tests {
    use super::*;

    #[test]
    fn generate_rpc_user_has_wallet_prefix() {
        let user = generate_rpc_user();
        assert!(user.starts_with("wallet_"));
        assert!(user.len() > "wallet_".len());
    }

    #[test]
    fn generate_rpc_password_is_non_empty_uuid() {
        let pass = generate_rpc_password();
        assert!(!pass.is_empty());
        assert!(pass.len() >= 32);
    }

    #[test]
    fn detects_incomplete_chain_snapshot() {
        let tmp = std::env::temp_dir().join(format!("chain-test-{}", uuid::Uuid::new_v4()));
        let blocks = tmp.join("blocks");
        let chainstate = tmp.join("chainstate");
        std::fs::create_dir_all(&blocks).unwrap();
        std::fs::create_dir_all(&chainstate).unwrap();
        std::fs::write(blocks.join("blk00000.dat"), vec![0u8; 20_000_000]).unwrap();
        std::fs::write(chainstate.join("CURRENT"), b"CURRENT").unwrap();
        assert!(chain_snapshot_needs_reindex(&tmp));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn detects_stripped_block_index_after_unified_bootstrap() {
        let tmp = std::env::temp_dir().join(format!("chain-idx-{}", uuid::Uuid::new_v4()));
        let blocks = tmp.join("blocks");
        let chainstate = tmp.join("chainstate");
        std::fs::create_dir_all(&blocks).unwrap();
        std::fs::create_dir_all(&chainstate).unwrap();
        std::fs::write(blocks.join("blk00000.dat"), vec![0u8; 20_000_000]).unwrap();
        std::fs::write(chainstate.join("CURRENT"), b"CURRENT").unwrap();
        std::fs::write(chainstate.join("000003.log"), vec![0u8; 2_000_000]).unwrap();
        assert!(!chain_snapshot_needs_reindex(&tmp));
        assert!(chain_index_needs_rebuild(&tmp));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
