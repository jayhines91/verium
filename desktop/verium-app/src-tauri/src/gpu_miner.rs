//! Optional experimental GPU miner sidecar (off by default).

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuMinerConfig {
    pub enabled: bool,
    pub binary_path: Option<String>,
    pub pool_url: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuMinerStatus {
    pub running: bool,
    pub hashrate: f64,
    pub last_log_line: String,
}

pub struct GpuMinerHandle {
    child: Mutex<Option<Child>>,
    status: Mutex<GpuMinerStatus>,
}

impl GpuMinerHandle {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            status: Mutex::new(GpuMinerStatus::default()),
        }
    }

    pub async fn status(&self) -> GpuMinerStatus {
        self.status.lock().await.clone()
    }

    pub async fn stop(&self) -> AppResult<()> {
        let mut guard = self.child.lock().await;
        if let Some(mut child) = guard.take() {
            let _ = child.kill().await;
        }
        let mut st = self.status.lock().await;
        st.running = false;
        Ok(())
    }

    pub async fn start(&self, cfg: &GpuMinerConfig, rpc_url: &str, rpc_user: &str, rpc_pass: &str) -> AppResult<()> {
        if !cfg.enabled {
            return Err(AppError::other("GPU miner is disabled (experimental opt-in)"));
        }
        let bin = cfg
            .binary_path
            .as_ref()
            .map(PathBuf::from)
            .filter(|p| p.exists())
            .ok_or_else(|| AppError::other("GPU miner binary path not configured or missing"))?;

        self.stop().await?;

        let mut cmd = Command::new(&bin);
        cmd.arg("--url").arg(rpc_url);
        cmd.arg("--userpass").arg(format!("{rpc_user}:{rpc_pass}"));
        cmd.arg("--coinbase-addr=local");
        if let Some(pool) = &cfg.pool_url {
            cmd.arg("--pool").arg(pool);
        }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| AppError::other(format!("GPU miner spawn failed: {e}")))?;
        let stdout = child.stdout.take();
        let status = Arc::new(Mutex::new(GpuMinerStatus {
            running: true,
            ..GpuMinerStatus::default()
        }));
        *self.status.lock().await = status.lock().await.clone();
        *self.child.lock().await = Some(child);

        if let Some(out) = stdout {
            let status_clone = Arc::clone(&status);
            tokio::spawn(async move {
                let reader = BufReader::new(out);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let mut st = status_clone.lock().await;
                    st.last_log_line = line.clone();
                    if let Some(hr) = parse_hashrate(&line) {
                        st.hashrate = hr;
                    }
                }
                let mut st = status_clone.lock().await;
                st.running = false;
            });
        }

        Ok(())
    }
}

fn parse_hashrate(line: &str) -> Option<f64> {
    for token in line.split_whitespace() {
        if let Ok(v) = token.parse::<f64>() {
            if line.to_lowercase().contains("hash") || line.contains("H/s") || line.contains("H/m") {
                return Some(v);
            }
        }
    }
    None
}

#[tauri::command]
pub async fn gpu_miner_status(handle: tauri::State<'_, GpuMinerHandle>) -> AppResult<GpuMinerStatus> {
    Ok(handle.status().await)
}

#[tauri::command]
pub async fn gpu_miner_stop(handle: tauri::State<'_, GpuMinerHandle>) -> AppResult<()> {
    handle.stop().await
}

#[tauri::command]
pub async fn gpu_miner_start(
    handle: tauri::State<'_, GpuMinerHandle>,
    config: GpuMinerConfig,
    rpc_url: String,
    rpc_user: String,
    rpc_pass: String,
) -> AppResult<()> {
    handle.start(&config, &rpc_url, &rpc_user, &rpc_pass).await
}
