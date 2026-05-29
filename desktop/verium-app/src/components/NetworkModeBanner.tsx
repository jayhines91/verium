// Copyright (c) 2026 The Vericonomy developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.
//
// Persistent banner shown at the top of AppShell whenever the wallet is
// pointed at the binarytest (DACE) network. The banner is intentionally
// loud — it's the visual safety guard that prevents users from confusing
// their test wallet with their real wallet.

import { Link } from "react-router-dom";
import { useIsTestNetwork } from "@/lib/network-mode";

export function NetworkModeBanner() {
  const isTest = useIsTestNetwork();
  if (!isTest) return null;

  return (
    <div className="w-full bg-amber-500/20 border-b border-amber-500/50 text-amber-100 px-4 py-2 text-xs flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="font-semibold uppercase tracking-wide">Binarytest</span>
        <span className="text-amber-200/80">
          DACE test network — funds have no real value. Distinct datadirs and
          ports; cannot connect to mainnet peers.
        </span>
      </div>
      <Link
        to="/binary-chain"
        className="font-semibold hover:text-amber-50 underline underline-offset-2 mr-4"
      >
        Binary Chain status
      </Link>
      <Link
        to="/settings"
        className="font-semibold hover:text-amber-50 underline underline-offset-2"
      >
        Switch back to mainnet
      </Link>
    </div>
  );
}
