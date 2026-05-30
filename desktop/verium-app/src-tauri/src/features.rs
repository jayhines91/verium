// Copyright (c) 2026 The Vericonomy developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

use crate::coin_profile::NetworkMode;

/// DACE binarytest is hidden in alpha builds. Set `VERICONOMY_BINARYTEST=1` to
/// override locally when developing against binarytest daemons.
pub fn binarytest_enabled() -> bool {
    if std::env::var("VERICONOMY_BINARYTEST").ok().as_deref() == Some("1") {
        return true;
    }
    !env!("CARGO_PKG_VERSION").contains("alpha")
}

pub fn effective_network_mode(stored: NetworkMode) -> NetworkMode {
    if stored.is_test() && !binarytest_enabled() {
        NetworkMode::Mainnet
    } else {
        stored
    }
}
