use std::collections::HashMap;
use std::path::PathBuf;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CoinId {
    Verium,
    Vericoin,
}

impl CoinId {
    pub fn all() -> &'static [CoinId] {
        &[CoinId::Verium, CoinId::Vericoin]
    }

    pub fn as_str(self) -> &'static str {
        match self {
            CoinId::Verium => "verium",
            CoinId::Vericoin => "vericoin",
        }
    }

    pub fn symbol(self) -> &'static str {
        match self {
            CoinId::Verium => "VRM",
            CoinId::Vericoin => "VRC",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            CoinId::Verium => "Verium",
            CoinId::Vericoin => "Vericoin",
        }
    }

    pub fn binary_base(self) -> &'static str {
        match self {
            CoinId::Verium => "veriumd",
            CoinId::Vericoin => "vericoind",
        }
    }

    pub fn conf_filename(self) -> &'static str {
        // Unified vericoin/veriumd builds read vericonomy.conf (see BITCOIN_CONF_FILENAME).
        "vericonomy.conf"
    }

    pub fn default_rpc_port(self) -> u16 {
        match self {
            CoinId::Verium => 33987,
            CoinId::Vericoin => 58683,
        }
    }

    /// Default P2P listen port for outbound `addnode` targets on mainnet.
    pub fn default_p2p_port(self) -> u16 {
        match self {
            CoinId::Verium => 36988,
            CoinId::Vericoin => 58684,
        }
    }

    pub fn default_network_chain(self) -> &'static str {
        match self {
            CoinId::Verium => "main",
            CoinId::Vericoin => "vericoin",
        }
    }

    pub fn conf_section(self) -> Option<&'static str> {
        match self {
            CoinId::Verium => Some("verium"),
            CoinId::Vericoin => Some("vericoin"),
        }
    }

    pub fn chain_cli_arg(self) -> Option<&'static str> {
        match self {
            CoinId::Verium => Some("-verium"),
            CoinId::Vericoin => Some("-chain=vericoin"),
        }
    }

    pub fn default_datadir(self) -> PathBuf {
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        {
            if let Some(d) = dirs::data_dir() {
                return match self {
                    CoinId::Verium => d.join("Verium"),
                    CoinId::Vericoin => d.join("Vericonomy"),
                };
            }
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            if let Some(h) = dirs::home_dir() {
                return match self {
                    CoinId::Verium => h.join(".verium"),
                    CoinId::Vericoin => h.join(".vericonomy"),
                };
            }
        }
        PathBuf::from(".")
    }

    pub fn bootstrap_cdn_base(self) -> &'static str {
        match self {
            CoinId::Verium => "https://files.vericonomy.com/vrm/bootstrap",
            CoinId::Vericoin => "https://files.vericonomy.com/vrc/bootstrap",
        }
    }

    pub fn explorer_api_base(self) -> &'static str {
        match self {
            CoinId::Verium => "https://explorer-vrm.vericonomy.com/rest/api/1",
            CoinId::Vericoin => "https://explorer-vrc.vericonomy.com/rest/api/1",
        }
    }

    pub fn explorer_logo_url(self) -> &'static str {
        match self {
            CoinId::Verium => "https://explorer-vrm.vericonomy.com/assets/images/logo.png",
            CoinId::Vericoin => "https://explorer-vrc.vericonomy.com/assets/images/logo.png",
        }
    }

    pub fn confirmations_matured(self) -> u32 {
        match self {
            CoinId::Verium => 100,
            CoinId::Vericoin => 500,
        }
    }

    pub fn earn_mode(self) -> &'static str {
        match self {
            CoinId::Verium => "mining",
            CoinId::Vericoin => "staking",
        }
    }

    pub fn keychain_service(self) -> String {
        format!("com.vericonomy.wallet.desktop.{}", self.as_str())
    }

    pub fn default_rpc_user(self) -> &'static str {
        match self {
            CoinId::Verium => "veriumwallet",
            CoinId::Vericoin => "vericoinwallet",
        }
    }

    pub fn wallet_backup_prefix(self) -> &'static str {
        match self {
            CoinId::Verium => "verium-wallet",
            CoinId::Vericoin => "vericoin-wallet",
        }
    }
}

// ---------------------------------------------------------------------------
// NetworkMode: orthogonal to CoinId. Switches the daemon between mainnet and
// the isolated Binary Chain v3 (DACE) binarytest network.
// ---------------------------------------------------------------------------

/// Which physical network a coin is operating against. Mainnet is the
/// default; BinaryTest is the isolated Binary Chain v3 (DACE) test network
/// defined in vericoin/src/chainparams.cpp (CBinaryTestVericoinParams and
/// CBinaryTestVeriumParams) and documented in
/// vericoin/doc/dace/binarytest-network.md.
///
/// The two modes use distinct ports, message-start magic, datadirs, and
/// address prefixes — a binarytest daemon physically cannot peer with a
/// mainnet daemon. See vericoin/test/binarychain/README.md.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum NetworkMode {
    #[default]
    Mainnet,
    BinaryTest,
}

impl NetworkMode {
    pub fn as_str(self) -> &'static str {
        match self {
            NetworkMode::Mainnet => "mainnet",
            NetworkMode::BinaryTest => "binarytest",
        }
    }

    pub fn is_test(self) -> bool {
        matches!(self, NetworkMode::BinaryTest)
    }
}

/// Combined identity for a (coin, network) pair. Most daemon-side state is
/// keyed by this so a wallet can hold mainnet AND binarytest configurations
/// without collision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CoinTarget {
    pub coin: CoinId,
    pub network: NetworkMode,
}

impl CoinTarget {
    pub fn new(coin: CoinId, network: NetworkMode) -> Self {
        Self { coin, network }
    }

    pub fn mainnet(coin: CoinId) -> Self {
        Self::new(coin, NetworkMode::Mainnet)
    }

    pub fn binarytest(coin: CoinId) -> Self {
        Self::new(coin, NetworkMode::BinaryTest)
    }

    /// Daemon RPC port. Binarytest uses 41683 (VRC) / 41987 (VRM).
    pub fn rpc_port(&self) -> u16 {
        match (self.coin, self.network) {
            (CoinId::Verium,   NetworkMode::Mainnet)    => 33987,
            (CoinId::Vericoin, NetworkMode::Mainnet)    => 58683,
            (CoinId::Verium,   NetworkMode::BinaryTest) => 41987,
            (CoinId::Vericoin, NetworkMode::BinaryTest) => 41683,
        }
    }

    /// Datadir subdirectory under the platform-default base. Binarytest gets
    /// the `binarytest-` prefix so it cannot collide with mainnet state.
    pub fn datadir(&self) -> PathBuf {
        let base_default = self.coin.default_datadir();
        match self.network {
            NetworkMode::Mainnet => base_default,
            NetworkMode::BinaryTest => {
                // Place binarytest under a parallel subdirectory of the
                // platform-default base. On Windows that is
                //   %APPDATA%\Vericonomy\binarytest-vericoin\
                //   %APPDATA%\Verium\binarytest-verium\
                let dir_name = match self.coin {
                    CoinId::Verium => "binarytest-verium",
                    CoinId::Vericoin => "binarytest-vericoin",
                };
                if let Some(parent) = base_default.parent() {
                    parent.join(dir_name)
                } else {
                    PathBuf::from(dir_name)
                }
            }
        }
    }

    /// Extra CLI args the daemon needs. Binarytest requires `-binarytest`
    /// in addition to `-vericoin` / `-verium`.
    pub fn extra_cli_args(&self) -> Vec<&'static str> {
        let mut out = Vec::new();
        if self.network.is_test() {
            out.push("-binarytest");
        }
        match self.coin {
            CoinId::Verium => out.push("-verium"),
            CoinId::Vericoin => out.push("-vericoin"),
        }
        out
    }

    /// Suppress explorer URL when running on the binarytest network — there
    /// is no public explorer for binarytest. Callers should hide explorer
    /// links in this mode.
    pub fn explorer_api_base(&self) -> Option<&'static str> {
        match self.network {
            NetworkMode::Mainnet => Some(self.coin.explorer_api_base()),
            NetworkMode::BinaryTest => None,
        }
    }

    /// Suppress bootstrap CDN on binarytest — no canonical snapshot.
    pub fn bootstrap_cdn_base(&self) -> Option<&'static str> {
        match self.network {
            NetworkMode::Mainnet => Some(self.coin.bootstrap_cdn_base()),
            NetworkMode::BinaryTest => None,
        }
    }

    pub fn keychain_service(&self) -> String {
        match self.network {
            NetworkMode::Mainnet => self.coin.keychain_service(),
            NetworkMode::BinaryTest => {
                format!("com.vericonomy.wallet.desktop.binarytest.{}", self.coin.as_str())
            }
        }
    }
}

impl FromStr for CoinId {
    type Err = AppError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        parse_coin_id(s)
    }
}

pub fn parse_coin_id(s: &str) -> AppResult<CoinId> {
    match s.trim().to_ascii_lowercase().as_str() {
        "verium" | "vrm" => Ok(CoinId::Verium),
        "vericoin" | "vrc" => Ok(CoinId::Vericoin),
        other => Err(AppError::other(format!("unknown coin: {other}"))),
    }
}

pub fn assert_verium(coin: CoinId) -> AppResult<()> {
    if coin != CoinId::Verium {
        return Err(AppError::other(format!(
            "command is only supported for Verium, not {}",
            coin.as_str()
        )));
    }
    Ok(())
}

pub fn assert_vericoin(coin: CoinId) -> AppResult<()> {
    if coin != CoinId::Vericoin {
        return Err(AppError::other(format!(
            "command is only supported for Vericoin, not {}",
            coin.as_str()
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct CoinProfileSummary {
    pub id: String,
    pub symbol: String,
    pub display_name: String,
    pub tagline: String,
    pub earn_mode: String,
    pub default_rpc_port: u16,
    pub confirmations_matured: u32,
}

pub fn profile_summary(coin: CoinId) -> CoinProfileSummary {
    let tagline = match coin {
        CoinId::Verium => "Reserve",
        CoinId::Vericoin => "Currency",
    };
    CoinProfileSummary {
        id: coin.as_str().to_string(),
        symbol: coin.symbol().to_string(),
        display_name: coin.display_name().to_string(),
        tagline: tagline.to_string(),
        earn_mode: coin.earn_mode().to_string(),
        default_rpc_port: coin.default_rpc_port(),
        confirmations_matured: coin.confirmations_matured(),
    }
}

pub fn all_profile_summaries() -> Vec<CoinProfileSummary> {
    CoinId::all()
        .iter()
        .copied()
        .map(profile_summary)
        .collect()
}

pub fn coin_map<T: Clone>(value_fn: impl Fn(CoinId) -> T) -> HashMap<String, T> {
    CoinId::all()
        .iter()
        .map(|coin| (coin.as_str().to_string(), value_fn(*coin)))
        .collect()
}
