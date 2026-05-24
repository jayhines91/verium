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
        match self {
            CoinId::Verium => "verium.conf",
            CoinId::Vericoin => "vericonomy.conf",
        }
    }

    pub fn default_rpc_port(self) -> u16 {
        match self {
            CoinId::Verium => 33987,
            CoinId::Vericoin => 58683,
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
            CoinId::Verium => None,
            CoinId::Vericoin => Some("vericoin"),
        }
    }

    pub fn chain_cli_arg(self) -> Option<&'static str> {
        match self {
            CoinId::Verium => None,
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
