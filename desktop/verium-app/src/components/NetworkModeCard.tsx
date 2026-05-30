// Copyright (c) 2026 The Vericonomy developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.
//
// Network mode toggle card for the Settings page. Lets the user switch
// between mainnet and the isolated Binary Chain v3 (DACE) test network.

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { BINARYTEST_ENABLED } from "@/lib/features";
import {
  type NetworkMode,
  useNetworkMode,
  useNetworkModePreview,
  useSetNetworkMode,
} from "@/lib/network-mode";
import { cn } from "@/lib/utils";

const DACE_BUILD_HINT = `# Windows (PowerShell, from repo root):
.\\vericoin\\build-dace.ps1

# Or manually in WSL:
cd vericoin && ./build-dace.sh
cd verium/desktop/verium-app && npm run fetch:sidecars:dace`;

function EndpointList({
  endpoints,
  title,
}: {
  endpoints: { coin: string; rpc_url: string; datadir: string }[];
  title: string;
}) {
  return (
    <div className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs">
      <div className="mb-2 font-semibold text-fg">{title}</div>
      <div className="flex flex-col gap-2">
        {endpoints.map((e) => (
          <div key={e.coin}>
            <div className="font-medium capitalize text-fg-muted">{e.coin}</div>
            <div className="truncate text-fg-subtle">RPC: {e.rpc_url}</div>
            <div className="truncate text-fg-subtle">datadir: {e.datadir}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MainnetNetworkCard() {
  const current = useNetworkMode();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Network</CardTitle>
        <CardDescription>This wallet connects to mainnet.</CardDescription>
      </CardHeader>
      {current.data && (
        <CardContent>
          <EndpointList
            title="Active endpoints"
            endpoints={current.data.coin_endpoints}
          />
        </CardContent>
      )}
    </Card>
  );
}

export function NetworkModeCard() {
  if (!BINARYTEST_ENABLED) {
    return <MainnetNetworkCard />;
  }

  return <NetworkModeCardWithBinarytest />;
}

function NetworkModeCardWithBinarytest() {
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
      for (const coin of ["verium", "vericoin"]) {
        try {
          await invoke("stop_daemon", { coin });
        } catch {
          /* ignore */
        }
      }
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
    <>
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle>Network</CardTitle>
            <CardDescription>
              Mainnet uses real coins. Binarytest is an isolated DACE test
              network — play money, distinct ports and datadirs, cannot peer
              with mainnet.
            </CardDescription>
          </div>
          {isTest && <Badge tone="warning">Binarytest</Badge>}
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div
            role="radiogroup"
            aria-label="Network mode"
            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            <button
              type="button"
              role="radio"
              aria-checked={activeMode === "mainnet"}
              onClick={() => onRequestSwitch("mainnet")}
              className={cn(
                "rounded-md border px-3 py-2.5 text-left text-sm transition-colors",
                activeMode === "mainnet"
                  ? "border-accent bg-accent/10"
                  : "border-border bg-bg-subtle hover:border-border-strong hover:bg-bg-panel",
              )}
            >
              <div className="font-medium text-fg">Mainnet</div>
              <div className="mt-0.5 text-xs text-fg-subtle">
                Real coins · standard ports
              </div>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={activeMode === "binarytest"}
              onClick={() => onRequestSwitch("binarytest")}
              disabled={!current.data?.dace_ready}
              title={
                current.data?.dace_ready
                  ? undefined
                  : (current.data?.dace_missing_hint ?? "DACE daemons required")
              }
              className={cn(
                "rounded-md border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                activeMode === "binarytest"
                  ? "border-warning bg-warning/10"
                  : "border-border bg-bg-subtle hover:border-border-strong hover:bg-bg-panel",
              )}
            >
              <div className="font-medium text-fg">Binarytest (DACE)</div>
              <div className="mt-0.5 text-xs text-fg-subtle">
                Play money · ports 41683 / 41987
              </div>
            </button>
          </div>

          {!current.data?.dace_ready && current.data?.dace_missing_hint && (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-3 text-xs text-warning">
              <div className="font-semibold">DACE daemons not installed</div>
              <p className="mt-1">{current.data.dace_missing_hint}</p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-fg-subtle">
                {DACE_BUILD_HINT}
              </pre>
            </div>
          )}

          {current.data && (
            <EndpointList
              title="Active endpoints"
              endpoints={current.data.coin_endpoints}
            />
          )}
        </CardContent>
      </Card>

      {pending && preview.data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPending(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="network-mode-confirm-title"
            className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-bg-panel shadow-2xl"
          >
            <div className="border-b border-border px-5 py-3">
              <h4
                id="network-mode-confirm-title"
                className="text-base font-semibold text-fg"
              >
                Switch to{" "}
                {pending === "binarytest" ? "Binarytest (DACE)" : "Mainnet"}?
              </h4>
            </div>

            <div className="flex flex-col gap-4 px-5 py-4 text-sm">
              {preview.data.warning && (
                <p className="text-sm text-warning">{preview.data.warning}</p>
              )}
              {!preview.data.dace_ready && pending === "binarytest" && (
                <p className="text-sm text-danger">
                  {preview.data.dace_missing_hint ??
                    "Install DACE-capable daemons before switching."}
                </p>
              )}

              <EndpointList
                title="After switching"
                endpoints={preview.data.coin_endpoints}
              />

              <p className="text-xs text-fg-subtle">
                The wallet will write a new daemon config, persist the choice in
                preferences, and restart both daemons. No coins move between
                networks; addresses are not cross-compatible.
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPending(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className={
                  pending === "binarytest"
                    ? "bg-warning text-white hover:bg-warning/90 focus-visible:ring-warning"
                    : undefined
                }
                onClick={() => void onConfirm()}
                disabled={
                  setMode.isPending ||
                  (pending === "binarytest" && !preview.data.dace_ready)
                }
              >
                {setMode.isPending ? "Switching…" : "Confirm switch"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
