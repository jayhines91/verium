use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tokio::sync::RwLock;

use crate::coin_profile::CoinId;
use crate::config::{load_config_for_network, refresh_config_paths, DaemonConfig};
use crate::daemon::DaemonManager;
use crate::error::{AppError, AppResult};
use crate::features::effective_network_mode;
use crate::prefs;
use crate::rpc::RpcClient;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

struct Inner {
    coins: HashMap<CoinId, CoinRuntime>,
    bootstrap_cancel: Mutex<HashMap<CoinId, Arc<AtomicBool>>>,
    /// Suppress competing daemon starts while veriumd loads imported chainstate.
    bootstrap_loading_until: Mutex<HashMap<CoinId, Instant>>,
    auto_reindex_attempted: Mutex<HashSet<CoinId>>,
    /// When the wallet last spawned a daemon for each coin (suppresses duplicate auto-starts).
    last_spawn_at: Mutex<HashMap<CoinId, Instant>>,
    /// Throttle automatic chain repair retries per coin.
    last_repair_at: Mutex<HashMap<CoinId, Instant>>,
    /// Unified bootstrap / stripped index: only start with `-reindex` until RPC syncs.
    pending_reindex: Mutex<HashSet<CoinId>>,
    auth_restart_attempts: Mutex<HashMap<CoinId, u32>>,
    daemon_phase: Mutex<HashMap<CoinId, String>>,
    /// Throttle background `reconsiderblock` clears (separate from full chain repair).
    last_invalid_clear_at: Mutex<HashMap<CoinId, Instant>>,
    /// Vericoin: P2P paused via `setnetworkactive false` while txindex catches up.
    txindex_network_paused: Mutex<HashSet<CoinId>>,
}

pub use crate::node::constants::{
    AUTH_RETRY_MAX, BOOTSTRAP_LOADING_GRACE, INVALID_CLEAR_COOLDOWN,
    POST_BOOTSTRAP_REINDEX_GRACE, REPAIR_BACKOFF, SPAWN_COOLDOWN,
};

pub struct CoinRuntime {
    pub coin: CoinId,
    pub config: RwLock<DaemonConfig>,
    pub earn: RwLock<EarnLocalState>,
    pub daemon: DaemonManager,
    /// Serializes ensure/start/restart for this coin.
    pub ensure_lock: tokio::sync::Mutex<()>,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct EarnLocalState {
    pub active: bool,
    pub threads: u32,
    pub started_at: Option<u64>,
}

/// Backwards-compatible alias used by mining commands.
pub type MinerLocalState = EarnLocalState;

impl AppState {
    pub fn initialize(app: AppHandle) -> AppResult<Self> {
        let prefs = prefs::load_sync().unwrap_or_default();
        let network_mode = effective_network_mode(prefs.network_mode);
        let mut coins = HashMap::new();
        for coin in CoinId::all() {
            let config = load_config_for_network(*coin, network_mode)?;
            // First-run datadir/conf work runs on the async orchestrator so the UI
            // window is not blocked by chain promotion or daemon `-help` probes.
            coins.insert(
                *coin,
                CoinRuntime {
                    coin: *coin,
                    config: RwLock::new(config),
                    earn: RwLock::new(EarnLocalState::default()),
                    daemon: DaemonManager::new(app.clone(), *coin),
                    ensure_lock: tokio::sync::Mutex::new(()),
                },
            );
        }
        Ok(Self {
            inner: Arc::new(Inner {
                coins,
                bootstrap_cancel: Mutex::new(HashMap::new()),
                bootstrap_loading_until: Mutex::new(HashMap::new()),
                auto_reindex_attempted: Mutex::new(HashSet::new()),
                last_spawn_at: Mutex::new(HashMap::new()),
                last_repair_at: Mutex::new(HashMap::new()),
                pending_reindex: Mutex::new(HashSet::new()),
                auth_restart_attempts: Mutex::new(HashMap::new()),
                daemon_phase: Mutex::new(HashMap::new()),
                last_invalid_clear_at: Mutex::new(HashMap::new()),
                txindex_network_paused: Mutex::new(HashSet::new()),
            }),
        })
    }

    pub fn txindex_network_paused(&self, coin: CoinId) -> bool {
        self.inner
            .txindex_network_paused
            .lock()
            .ok()
            .map(|set| set.contains(&coin))
            .unwrap_or(false)
    }

    pub fn set_txindex_network_paused(&self, coin: CoinId, paused: bool) {
        let Ok(mut set) = self.inner.txindex_network_paused.lock() else {
            return;
        };
        if paused {
            set.insert(coin);
        } else {
            set.remove(&coin);
        }
    }

    pub fn mark_invalid_clear_attempt(&self, coin: CoinId) {
        if let Ok(mut map) = self.inner.last_invalid_clear_at.lock() {
            map.insert(coin, Instant::now());
        }
    }

    pub fn invalid_clear_backoff_active(&self, coin: CoinId) -> bool {
        let Ok(map) = self.inner.last_invalid_clear_at.lock() else {
            return false;
        };
        map.get(&coin)
            .map(|t| t.elapsed() < INVALID_CLEAR_COOLDOWN)
            .unwrap_or(false)
    }

    /// Registers a bootstrap session and returns its cooperative cancel flag.
    pub fn bootstrap_begin(&self, coin: CoinId) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut sessions) = self.inner.bootstrap_cancel.lock() {
            sessions.insert(coin, flag.clone());
        }
        flag
    }

    pub fn bootstrap_request_cancel(&self, coin: CoinId) {
        if let Ok(sessions) = self.inner.bootstrap_cancel.lock() {
            if let Some(flag) = sessions.get(&coin) {
                flag.store(true, Ordering::SeqCst);
            }
        }
    }

    pub fn bootstrap_is_cancelled(cancel: &AtomicBool) -> bool {
        cancel.load(Ordering::SeqCst)
    }

    pub fn bootstrap_end(&self, coin: CoinId) {
        if let Ok(mut sessions) = self.inner.bootstrap_cancel.lock() {
            sessions.remove(&coin);
        }
    }

    /// True while any bootstrap import is in progress (blocks auto daemon start).
    pub fn bootstrap_session_active(&self) -> bool {
        self.inner
            .bootstrap_cancel
            .lock()
            .map(|s| !s.is_empty())
            .unwrap_or(false)
    }

    /// After bootstrap restart, block ensure/start from spawning a competing daemon.
    pub fn mark_bootstrap_loading(&self, coin: CoinId, grace: Duration) {
        if let Ok(mut map) = self.inner.bootstrap_loading_until.lock() {
            map.insert(coin, Instant::now() + grace);
        }
    }

    pub fn clear_bootstrap_loading(&self, coin: CoinId) {
        if let Ok(mut map) = self.inner.bootstrap_loading_until.lock() {
            map.remove(&coin);
        }
    }

    pub fn bootstrap_loading_active(&self, coin: CoinId) -> bool {
        let Ok(mut map) = self.inner.bootstrap_loading_until.lock() else {
            return false;
        };
        match map.get(&coin) {
            Some(until) if Instant::now() < *until => true,
            Some(_) => {
                map.remove(&coin);
                false
            }
            None => false,
        }
    }

    /// Record a one-shot automatic `-reindex` attempt per coin per wallet session.
    pub fn try_mark_auto_reindex(&self, coin: CoinId) -> bool {
        self.inner
            .auto_reindex_attempted
            .lock()
            .map(|mut set| set.insert(coin))
            .unwrap_or(false)
    }

    pub fn clear_auto_reindex_attempt(&self, coin: CoinId) {
        if let Ok(mut set) = self.inner.auto_reindex_attempted.lock() {
            set.remove(&coin);
        }
    }

    pub fn auto_reindex_was_attempted(&self, coin: CoinId) -> bool {
        self.inner
            .auto_reindex_attempted
            .lock()
            .map(|set| set.contains(&coin))
            .unwrap_or(false)
    }

    pub fn mark_pending_reindex(&self, coin: CoinId) {
        if let Ok(mut set) = self.inner.pending_reindex.lock() {
            set.insert(coin);
        }
    }

    pub fn clear_pending_reindex(&self, coin: CoinId) {
        if let Ok(mut set) = self.inner.pending_reindex.lock() {
            set.remove(&coin);
        }
    }

    pub fn pending_reindex_active(&self, coin: CoinId) -> bool {
        self.inner
            .pending_reindex
            .lock()
            .map(|set| set.contains(&coin))
            .unwrap_or(false)
    }

    pub fn increment_auth_restart(&self, coin: CoinId) -> u32 {
        self.inner
            .auth_restart_attempts
            .lock()
            .map(|mut map| {
                let next = map.get(&coin).copied().unwrap_or(0) + 1;
                map.insert(coin, next);
                next
            })
            .unwrap_or(0)
    }

    pub fn clear_auth_restart_attempts(&self, coin: CoinId) {
        if let Ok(mut map) = self.inner.auth_restart_attempts.lock() {
            map.remove(&coin);
        }
    }

    pub fn auth_restart_exhausted(&self, coin: CoinId) -> bool {
        self.inner
            .auth_restart_attempts
            .lock()
            .map(|map| map.get(&coin).copied().unwrap_or(0) >= AUTH_RETRY_MAX)
            .unwrap_or(false)
    }

    pub fn mark_spawn(&self, coin: CoinId) {
        if let Ok(mut map) = self.inner.last_spawn_at.lock() {
            map.insert(coin, Instant::now());
        }
    }

    pub fn clear_spawn(&self, coin: CoinId) {
        if let Ok(mut map) = self.inner.last_spawn_at.lock() {
            map.remove(&coin);
        }
    }

    pub fn spawn_recent(&self, coin: CoinId) -> bool {
        let Ok(map) = self.inner.last_spawn_at.lock() else {
            return false;
        };
        map.get(&coin)
            .map(|t| t.elapsed() < SPAWN_COOLDOWN)
            .unwrap_or(false)
    }

    pub fn mark_repair_attempt(&self, coin: CoinId) {
        if let Ok(mut map) = self.inner.last_repair_at.lock() {
            map.insert(coin, Instant::now());
        }
    }

    pub fn repair_backoff_active(&self, coin: CoinId) -> bool {
        let Ok(map) = self.inner.last_repair_at.lock() else {
            return false;
        };
        map.get(&coin)
            .map(|t| t.elapsed() < REPAIR_BACKOFF)
            .unwrap_or(false)
    }

    pub fn set_daemon_phase(&self, coin: CoinId, phase: &str) {
        if let Ok(mut map) = self.inner.daemon_phase.lock() {
            map.insert(coin, phase.to_string());
        }
    }

    pub fn daemon_phase_label(&self, coin: CoinId) -> Option<String> {
        self.inner
            .daemon_phase
            .lock()
            .ok()
            .and_then(|map| map.get(&coin).cloned())
    }

    pub fn runtime(&self, coin: CoinId) -> AppResult<&CoinRuntime> {
        self.inner
            .coins
            .get(&coin)
            .ok_or_else(|| AppError::other(format!("unknown coin runtime: {}", coin.as_str())))
    }

    pub fn runtimes(&self) -> impl Iterator<Item = &CoinRuntime> {
        self.inner.coins.values()
    }

    pub async fn config(&self, coin: CoinId) -> AppResult<DaemonConfig> {
        Ok(self.runtime(coin)?.config.read().await.clone())
    }

    pub async fn config_fresh(&self, coin: CoinId) -> AppResult<DaemonConfig> {
        let rt = self.runtime(coin)?;
        let mut cfg = rt.config.read().await.clone();
        refresh_config_paths(coin, &mut cfg)?;
        self.replace_config(coin, cfg.clone()).await?;
        Ok(cfg)
    }

    pub async fn replace_config(&self, coin: CoinId, new_config: DaemonConfig) -> AppResult<()> {
        *self.runtime(coin)?.config.write().await = new_config;
        Ok(())
    }

    pub async fn earn(&self, coin: CoinId) -> AppResult<EarnLocalState> {
        Ok(self.runtime(coin)?.earn.read().await.clone())
    }

    pub async fn set_earn(&self, coin: CoinId, value: EarnLocalState) -> AppResult<()> {
        *self.runtime(coin)?.earn.write().await = value;
        Ok(())
    }

    pub fn daemon(&self, coin: CoinId) -> AppResult<&DaemonManager> {
        Ok(&self.runtime(coin)?.daemon)
    }

    pub async fn rpc_client(&self, coin: CoinId) -> AppResult<RpcClient> {
        let cfg = self.config_fresh(coin).await?;
        RpcClient::from_config_for_coin(coin, &cfg)
    }
}
