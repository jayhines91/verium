use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::AppHandle;
use tokio::sync::RwLock;

use crate::coin_profile::CoinId;
use crate::config::{ensure_first_run_config, load_or_default_config, refresh_config_paths, DaemonConfig};
use crate::daemon::DaemonManager;
use crate::error::{AppError, AppResult};
use crate::rpc::RpcClient;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

struct Inner {
    coins: HashMap<CoinId, CoinRuntime>,
    bootstrap_cancel: Mutex<HashMap<CoinId, Arc<AtomicBool>>>,
}

pub struct CoinRuntime {
    pub coin: CoinId,
    pub config: RwLock<DaemonConfig>,
    pub earn: RwLock<EarnLocalState>,
    pub daemon: DaemonManager,
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
        let mut coins = HashMap::new();
        for coin in CoinId::all() {
            let mut config = load_or_default_config(*coin)?;
            if let Err(e) = ensure_first_run_config(*coin, &mut config) {
                tracing::warn!("first-run config bootstrap failed for {}: {e}", coin.as_str());
            }
            coins.insert(
                *coin,
                CoinRuntime {
                    coin: *coin,
                    config: RwLock::new(config),
                    earn: RwLock::new(EarnLocalState::default()),
                    daemon: DaemonManager::new(app.clone(), *coin),
                },
            );
        }
        Ok(Self {
            inner: Arc::new(Inner {
                coins,
                bootstrap_cancel: Mutex::new(HashMap::new()),
            }),
        })
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
        RpcClient::from_config(&cfg)
    }
}
