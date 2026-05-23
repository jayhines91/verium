use std::sync::Arc;

use tauri::AppHandle;
use tokio::sync::RwLock;

use crate::config::{
    ensure_first_run_config, load_or_default_config, refresh_config_paths, DaemonConfig,
};
use crate::daemon::DaemonManager;
use crate::error::AppResult;
use crate::rpc::RpcClient;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

struct Inner {
    config: RwLock<DaemonConfig>,
    miner: RwLock<MinerLocalState>,
    daemon: DaemonManager,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct MinerLocalState {
    pub active: bool,
    pub threads: u32,
    pub started_at: Option<u64>,
}

impl AppState {
    pub fn initialize(app: AppHandle) -> AppResult<Self> {
        let mut config = load_or_default_config()?;
        // Bundled-sidecar deployments must auto-provision RPC creds on first run.
        if let Err(e) = ensure_first_run_config(&mut config) {
            tracing::warn!("first-run config bootstrap failed: {e}");
        }
        let daemon = DaemonManager::new(app);
        Ok(Self {
            inner: Arc::new(Inner {
                config: RwLock::new(config),
                miner: RwLock::new(MinerLocalState::default()),
                daemon,
            }),
        })
    }

    pub async fn config(&self) -> DaemonConfig {
        self.inner.config.read().await.clone()
    }

    pub async fn config_fresh(&self) -> AppResult<DaemonConfig> {
        let mut cfg = self.config().await;
        refresh_config_paths(&mut cfg)?;
        self.replace_config(cfg.clone()).await;
        Ok(cfg)
    }

    pub async fn replace_config(&self, new_config: DaemonConfig) {
        *self.inner.config.write().await = new_config;
    }

    pub async fn miner(&self) -> MinerLocalState {
        self.inner.miner.read().await.clone()
    }

    pub async fn set_miner(&self, value: MinerLocalState) {
        *self.inner.miner.write().await = value;
    }

    pub fn daemon(&self) -> &DaemonManager {
        &self.inner.daemon
    }

    pub async fn rpc_client(&self) -> AppResult<RpcClient> {
        let cfg = self.config_fresh().await?;
        RpcClient::from_config(&cfg)
    }
}
