use std::path::Path;
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::config::DaemonConfig;
use crate::error::{AppError, AppResult};
use crate::wsl::{is_wsl_unc_path, unc_to_linux_path, WslExec};

#[derive(Debug, Clone)]
pub struct RpcClient {
    http: Client,
    url: String,
    auth: RpcAuth,
}

#[derive(Debug, Clone)]
enum RpcAuth {
    Cookie(String, String),
    UserPass(String, String),
    None,
}

#[derive(Serialize)]
struct RpcRequest<'a> {
    jsonrpc: &'a str,
    id: &'a str,
    method: &'a str,
    params: Value,
}

#[derive(Deserialize)]
struct RpcResponse {
    result: Option<Value>,
    error: Option<RpcErrorBody>,
}

#[derive(Deserialize)]
struct RpcErrorBody {
    code: i64,
    message: String,
}

impl RpcClient {
    pub fn from_config(cfg: &DaemonConfig) -> AppResult<Self> {
        Self::from_config_with_timeout(cfg, Duration::from_secs(8))
    }

    pub fn from_config_with_timeout(
        cfg: &DaemonConfig,
        timeout: Duration,
    ) -> AppResult<Self> {
        let url = format!("http://{}:{}/", cfg.rpc_host, cfg.rpc_port);
        let auth = resolve_auth(cfg)?;
        let http = Client::builder().timeout(timeout).build()?;
        Ok(Self { http, url, auth })
    }

    pub fn with_wallet(&self, wallet: &str) -> Self {
        let base = self.url.trim_end_matches('/').to_string();
        let url = format!("{base}/wallet/{wallet}");
        Self {
            http: self.http.clone(),
            url,
            auth: self.auth.clone(),
        }
    }

    pub async fn call<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: Value,
    ) -> AppResult<T> {
        let body = RpcRequest {
            jsonrpc: "1.0",
            id: "verium-app",
            method,
            params,
        };
        let req = self.http.post(&self.url).json(&body);
        let req = match &self.auth {
            RpcAuth::Cookie(u, p) | RpcAuth::UserPass(u, p) => {
                req.basic_auth(u, Some(p))
            }
            RpcAuth::None => req,
        };
        let resp = req.send().await.map_err(|e| {
            if e.is_connect() || e.is_timeout() {
                AppError::DaemonUnreachable(e.to_string())
            } else {
                AppError::Http(e)
            }
        })?;
        let status = resp.status();
        let parsed: RpcResponse = if status.is_success() {
            resp.json().await?
        } else if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::DaemonUnreachable(
                "unauthorized: missing or invalid RPC credentials".into(),
            ));
        } else {
            let txt = resp.text().await.unwrap_or_default();
            match serde_json::from_str::<RpcResponse>(&txt) {
                Ok(p) => p,
                Err(_) => {
                    return Err(AppError::Other(format!(
                        "rpc http {status}: {txt}"
                    )))
                }
            }
        };
        if let Some(err) = parsed.error {
            return Err(AppError::Rpc {
                code: err.code,
                message: err.message,
            });
        }
        let result = parsed
            .result
            .ok_or_else(|| AppError::Other("rpc response missing result".into()))?;
        Ok(serde_json::from_value(result)?)
    }

    pub async fn call_no_result(&self, method: &str, params: Value) -> AppResult<()> {
        let _: Value = self.call(method, params).await?;
        Ok(())
    }

    pub async fn ping(&self) -> AppResult<()> {
        let _: Value = self.call("uptime", json!([])).await?;
        Ok(())
    }
}

fn resolve_auth(cfg: &DaemonConfig) -> AppResult<RpcAuth> {
    // When rpcpassword is in verium.conf, veriumd uses fixed rpcuser/rpcpassword at
    // startup — not .cookie (see InitRPCAuthentication in src/httprpc.cpp).
    if let (Some(user), Some(pass)) = (cfg.rpc_user.as_ref(), cfg.rpc_password.as_ref()) {
        if !pass.is_empty() {
            return Ok(RpcAuth::UserPass(user.clone(), pass.clone()));
        }
    }
    if let Some(path) = cfg.cookie_path.as_ref() {
        if let Some(pair) = read_cookie(path)? {
            return Ok(RpcAuth::Cookie(pair.0, pair.1));
        }
        if is_wsl_unc_path(&cfg.datadir) {
            if let Some(pair) = read_cookie_via_wsl(path, &cfg.datadir)? {
                return Ok(RpcAuth::Cookie(pair.0, pair.1));
            }
        }
    }
    Ok(RpcAuth::None)
}

fn read_cookie_via_wsl(cookie_path: &Path, unc_datadir: &Path) -> AppResult<Option<(String, String)>> {
    let linux_cookie = unc_to_linux_path(&cookie_path.to_string_lossy());
    let script = format!(
        r#"import os
p = {linux_cookie:?}
if not os.path.isfile(p):
    raise SystemExit(1)
print(open(p, encoding='utf-8').read().strip())
"#
    );
    let ctx = WslExec::for_unc(&unc_datadir.to_string_lossy());
    let output = ctx
        .exec("python3", &["-c", &script])
        .map_err(|e| AppError::other(format!("wsl cookie read failed: {e}")))?;
    if !output.status.success() {
        return Ok(None);
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let trimmed = raw.trim();
    let (user, pass) = match trimmed.split_once(':') {
        Some(pair) => pair,
        None => return Ok(None),
    };
    Ok(Some((user.to_string(), pass.to_string())))
}

fn read_cookie(path: &Path) -> AppResult<Option<(String, String)>> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(path)?;
    let trimmed = raw.trim();
    let (user, pass) = match trimmed.split_once(':') {
        Some(pair) => pair,
        None => return Ok(None),
    };
    Ok(Some((user.to_string(), pass.to_string())))
}
