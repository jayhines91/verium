use std::path::Path;

use crate::coin_profile::CoinId;
use crate::config::{rpc_auth_diagnostics, DaemonConfig};
use crate::error::AppResult;

#[derive(Debug, Clone)]
pub enum RpcAuth {
    UserPass(String, String),
    None,
}

pub fn resolve_managed_auth(coin: CoinId, cfg: &DaemonConfig) -> AppResult<RpcAuth> {
    let mut cfg = cfg.clone();
    let _ = crate::config::sync_cfg_rpc_credentials_from_conf(coin, &mut cfg);
    let diag = rpc_auth_diagnostics(coin, &cfg);
    if diag.rpc_user_in_conf && diag.rpc_password_in_conf {
        if let (Some(user), Some(pass)) = (cfg.rpc_user.as_ref(), cfg.rpc_password.as_ref()) {
            if !pass.is_empty() {
                return Ok(RpcAuth::UserPass(user.clone(), pass.clone()));
            }
        }
    }
    if let (Some(user), Some(pass)) = (cfg.rpc_user.as_ref(), cfg.rpc_password.as_ref()) {
        if !pass.is_empty() {
            return Ok(RpcAuth::UserPass(user.clone(), pass.clone()));
        }
    }
    Ok(RpcAuth::None)
}

pub fn resolve_managed_auth_methods(coin: CoinId, cfg: &DaemonConfig) -> AppResult<Vec<RpcAuth>> {
    match resolve_managed_auth(coin, cfg)? {
        RpcAuth::None => Ok(vec![]),
        auth => Ok(vec![auth]),
    }
}

pub fn auth_error_message() -> &'static str {
    "Could not authenticate with the node. Try Restart node from Settings."
}

pub fn is_unauthorized_message(msg: &str) -> bool {
    msg.to_lowercase().contains("unauthorized")
}

#[cfg(unix)]
pub fn restrict_conf_permissions(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    if path.is_file() {
        let mut perms = std::fs::metadata(path)?.permissions();
        perms.set_mode(0o600);
        std::fs::set_permissions(path, perms)?;
    }
    Ok(())
}

#[cfg(not(unix))]
pub fn restrict_conf_permissions(_path: &Path) -> AppResult<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn unauthorized_detection() {
        assert!(is_unauthorized_message("unauthorized: bad creds"));
        assert!(!is_unauthorized_message("connection refused"));
    }

    #[test]
    fn missing_creds_returns_none_auth() {
        let cfg = DaemonConfig {
            datadir: PathBuf::from("/tmp/test"),
            rpc_host: "127.0.0.1".into(),
            rpc_port: 33987,
            chain: "verium".into(),
            rpc_user: None,
            rpc_password: None,
            rpc_password_set: false,
            cookie_path: None,
        };
        assert!(matches!(
            resolve_managed_auth(CoinId::Verium, &cfg).unwrap(),
            RpcAuth::None
        ));
    }
}
