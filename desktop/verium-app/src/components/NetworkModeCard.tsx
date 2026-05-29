// Copyright (c) 2026 The Vericonomy developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.
//
// Network mode toggle card for the Settings page. Lets the user switch
// between mainnet and the isolated Binary Chain v3 (DACE) test network.

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  type NetworkMode,
  useNetworkMode,
  useNetworkModePreview,
  useSetNetworkMode,
} from "@/lib/network-mode";

const CARD = "rounded-md border border-zinc-700 bg-zinc-900/50 p-4 space-y-4";
const ENDPOINT = "text-xs text-zinc-400 truncate";

export function NetworkModeCard() {
  const current = useNetworkMode();
  const setMode = useSetNetworkMode();
  const [pending, setPending] = useState<NetworkMode | null>(null);
  const preview = useNetworkModePreview(pending);

  const activeMode = current.data?.mode ?? "mainnet";
  const isTest = current.data?.is_test ?? false;

  const onRequestSwitch = (target: NetworkMode) => {
    if (target === activeMode) return;
    setPending(target);
  };

  const onConfirm = async () => {
    if (!pending) return;
    try {
      await setMode.mutateAsync(pending);
      // Always stop+start both daemons so they pick up the new datadir
      // and ports. The mode switch is meaningless without this restart and
      // skipping it leads to confusing "still mainnet" UI states.
      for (const coin of ["verium", "vericoin"]) {
        try {
          await invoke("stop_daemon", { coin });
        } catch {
          /* ignore */
        }
      }
      // brief pause then start both
      await new Promise((r) => setTimeout(r, 1500));
      for (const coin of ["verium", "vericoin"]) {
        try {
          await invoke("start_daemon", { coin });
        } catch {
          /* ignore */
        }
      }
      setPending(null);
    } catch (e) {
      window.alert(`Failed to switch mode: ${e}`);
    }
  };

  return (
    <div className={CARD}>
      <header className="flex items-baseline justify-between">
        <div>
          <h3 className="text-base font-semibold">Network</h3>
          <p className="text-xs text-zinc-400">
            Mainnet uses real coins. Binarytest is an isolated DACE test network
            — play money, distinct ports and datadirs, cannot peer with mainnet.
          </p>
        </div>
        {isTest && (
          <span className="text-xs font-semibold uppercase tracking-wide rounded bg-amber-700/40 border border-amber-500/40 text-amber-200 px-2 py-1">
            Binarytest
          </span>
        )}
      </header>

      <div className="grid grid-cols-2 gap-2">
        <button
          className={`rounded border px-3 py-2 text-sm ${
            activeMode === "mainnet"
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
              : "border-zinc-600 hover:border-zinc-500"
          }`}
          onClick={() => onRequestSwitch("mainnet")}
        >
          Mainnet
          <div className="text-xs text-zinc-400 mt-1">
            Real coins · standard ports
          </div>
        </button>
        <button
          className={`rounded border px-3 py-2 text-sm ${
            activeMode === "binarytest"
              ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
              : "border-zinc-600 hover:border-zinc-500"
          } ${!current.data?.dace_ready ? "opacity-80" : ""}`}
          onClick={() => onRequestSwitch("binarytest")}
          disabled={!current.data?.dace_ready}
          title={
            current.data?.dace_ready
              ? undefined
              : (current.data?.dace_missing_hint ?? "DACE daemons required")
          }
        >
          Binarytest (DACE)
          <div className="text-xs text-zinc-400 mt-1">
            Play money · ports 41683 / 41987
          </div>
        </button>
      </div>

      {!current.data?.dace_ready && current.data?.dace_missing_hint && (
        <div className="rounded border border-amber-600/40 bg-amber-950/30 p-3 text-xs text-amber-200 space-y-2">
          <div className="font-semibold">DACE daemons not installed</div>
          <p>{current.data.dace_missing_hint}</p>
          <p className="text-zinc-400 whitespace-pre-wrap">
            {`# Windows (PowerShell, from repo root):\n.\\vericoin\\build-dace.ps1\n\n# Or manually in WSL:\ncd vericoin && ./build-dace.sh\ncd verium/desktop/verium-app && npm run fetch:sidecars:dace`}
          </p>
        </div>
      )}

      {/* Current endpoints */}
      {current.data && (
        <div className="rounded border border-zinc-700 p-3 text-xs space-y-2">
          <div className="font-semibold text-zinc-300">Active endpoints</div>
          {current.data.coin_endpoints.map((e) => (
            <div key={e.coin}>
              <div className="text-zinc-400">{e.coin}</div>
              <div className={ENDPOINT}>RPC: {e.rpc_url}</div>
              <div className={ENDPOINT}>datadir: {e.datadir}</div>
            </div>
          ))}
        </div>
      )}

      {/* Confirmation modal */}
      {pending && preview.data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-w-lg w-full rounded-lg border border-zinc-700 bg-zinc-900 p-6 space-y-4">
            <h4 className="text-lg font-semibold">
              Switch to{" "}
              {pending === "binarytest" ? "Binarytest (DACE)" : "Mainnet"}?
            </h4>
            {preview.data.warning && (
              <p className="text-sm text-amber-300">{preview.data.warning}</p>
            )}
            {!preview.data.dace_ready && pending === "binarytest" && (
              <p className="text-sm text-red-300">
                {preview.data.dace_missing_hint ??
                  "Install DACE-capable daemons before switching."}
              </p>
            )}
            <div className="rounded border border-zinc-700 p-3 text-xs space-y-2">
              <div className="font-semibold text-zinc-300">
                After switching:
              </div>
              {preview.data.coin_endpoints.map((e) => (
                <div key={e.coin}>
                  <div className="text-zinc-400">{e.coin}</div>
                  <div className={ENDPOINT}>RPC: {e.rpc_url}</div>
                  <div className={ENDPOINT}>datadir: {e.datadir}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-400">
              The wallet will write a new daemon config, persist the choice in
              preferences, and prompt you whether to restart the daemons now. No
              coins move between networks; addresses are not cross-compatible.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-2 rounded border border-zinc-600 hover:border-zinc-500 text-sm"
                onClick={() => setPending(null)}
              >
                Cancel
              </button>
              <button
                className={`px-3 py-2 rounded text-sm font-semibold ${
                  pending === "binarytest"
                    ? "bg-amber-600 hover:bg-amber-500 text-zinc-900"
                    : "bg-emerald-600 hover:bg-emerald-500 text-zinc-900"
                }`}
                onClick={onConfirm}
                disabled={
                  setMode.isPending ||
                  (pending === "binarytest" && !preview.data.dace_ready)
                }
              >
                {setMode.isPending ? "Switching…" : "Confirm switch"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
