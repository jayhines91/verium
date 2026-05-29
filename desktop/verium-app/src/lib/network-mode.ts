// Copyright (c) 2026 The Vericonomy developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.
//
// React-side hooks for the Binary Chain v3 (DACE) network-mode toggle.
//
// Mainnet (default): wallet talks to mainnet vericoind/veriumd on standard
//   RPC ports (58683/33987) under the mainnet datadirs.
// Binarytest: wallet talks to the isolated DACE test network on ports
//   41683/41987 under the binarytest-* datadirs. Funds have no real value.
//
// See vericoin/doc/dace/binarytest-network.md.

import { invoke } from "@tauri-apps/api/core";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CoinId } from "@/lib/coin/profile";
import { resetDaemonEnsureAttempt } from "@/hooks/useDaemonStatus";
import { isExplorerApiEnabled } from "@/lib/explorer-api";

export type NetworkMode = "mainnet" | "binarytest";

export interface CoinEndpoint {
  coin: string;
  rpc_url: string;
  datadir: string;
}

export interface NetworkModeInfo {
  mode: NetworkMode;
  is_test: boolean;
  /** Both sidecars support `-binarytest` (required for Binarytest). */
  dace_ready: boolean;
  dace_missing_hint: string | null;
  coin_endpoints: CoinEndpoint[];
  warning: string | null;
}

export async function rpcNetworkModeGet(): Promise<NetworkModeInfo> {
  return invoke<NetworkModeInfo>("network_mode_get");
}

export async function rpcNetworkModePreview(
  mode: NetworkMode,
): Promise<NetworkModeInfo> {
  return invoke<NetworkModeInfo>("network_mode_preview", { mode });
}

export async function rpcNetworkModeSet(
  mode: NetworkMode,
): Promise<NetworkModeInfo> {
  return invoke<NetworkModeInfo>("network_mode_set", { mode });
}

const QK = ["network-mode"] as const;

export function useNetworkMode() {
  return useQuery({
    queryKey: QK,
    queryFn: rpcNetworkModeGet,
    staleTime: 5_000,
  });
}

export function useNetworkModePreview(mode: NetworkMode | null) {
  return useQuery({
    queryKey: ["network-mode", "preview", mode],
    queryFn: () => rpcNetworkModePreview(mode!),
    enabled: !!mode,
  });
}

export function useSetNetworkMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rpcNetworkModeSet,
    onSuccess: (info) => {
      qc.setQueryData(QK, info);
      resetDaemonEnsureAttempt();
      // Drop cached mainnet RPC/explorer data — keys are prefixed by coin id.
      for (const coin of ["verium", "vericoin"] as CoinId[]) {
        qc.removeQueries({ queryKey: [coin] });
      }
      qc.removeQueries({ queryKey: ["binarychain_status"] });
      qc.removeQueries({ queryKey: ["binarychain_metrics"] });
      qc.removeQueries({ queryKey: ["binarychain_anchor"] });
    },
  });
}

/** Convenience: true when the wallet is currently pointed at binarytest. */
export function useIsTestNetwork(): boolean {
  const q = useNetworkMode();
  return q.data?.is_test ?? false;
}

/** Mainnet-only features (public explorer, market price, bootstrap CDN). */
export function useExplorerQueriesEnabled(): boolean {
  const isTest = useIsTestNetwork();
  const enabled = useQuery({
    queryKey: ["explorer-api-enabled"],
    queryFn: isExplorerApiEnabled,
    staleTime: Infinity,
  });
  return enabled.data === true && !isTest;
}
