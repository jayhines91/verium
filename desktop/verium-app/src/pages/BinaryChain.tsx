// Copyright (c) 2026 The Vericonomy developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  rpcBinaryChainStatus,
  rpcBinaryChainMetrics,
  rpcBinaryChainAnchor,
  rpcBinaryChainFundWallet,
  rpcBinaryChainRegisterTicket,
  rpcBinaryChainRedeemClaim,
  type BinaryChainFundResult,
} from "@/lib/rpc/dace";
import { coinQueryKey } from "@/lib/coin/profile";
import { useActiveCoin } from "@/lib/coin/context";
import { getCoinProfile } from "@/lib/coin/profile";
import { useNetworkMode } from "@/lib/network-mode";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import type { CoinId } from "@/lib/coin/profile";

const REFRESH_MS = 10_000;

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="border border-zinc-700 rounded-md p-3 bg-zinc-900/50">
      <div className="text-xs uppercase tracking-wide text-zinc-400">
        {label}
      </div>
      <div className="text-lg font-semibold mt-1">{value}</div>
      {hint && <div className="text-xs text-zinc-500 mt-1">{hint}</div>}
    </div>
  );
}

function isRpcWarmupError(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes("rpc error -28") ||
    msg.includes("rpc error -10") ||
    /warming up/i.test(msg) ||
    /loading block index/i.test(msg)
  );
}

function isDaceRpcMissing(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes("rpc error -32601") ||
    /method not found/i.test(msg) ||
    /unknown method/i.test(msg)
  );
}

function daceQueryRetry(failureCount: number, err: unknown): boolean {
  if (isRpcWarmupError(err)) return failureCount < 40;
  if (isDaceRpcMissing(err)) return false;
  return failureCount < 3;
}

function BinaryChainHeights() {
  const vrc = useDaemonStatus("vericoin");
  const vrm = useDaemonStatus("verium");

  const rows: {
    coin: CoinId;
    label: string;
    status: ReturnType<typeof useDaemonStatus>;
  }[] = [
    { coin: "vericoin", label: "Vericoin (VRC)", status: vrc },
    { coin: "verium", label: "Verium (VRM)", status: vrm },
  ];

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {rows.map(({ coin: rowCoin, label, status }) => {
        const blocks = status.data?.blocks;
        const chain = status.data?.chain ?? "…";
        const connected = status.data?.connected === true;
        return (
          <div
            key={rowCoin}
            className="rounded-md border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-sm"
          >
            <div className="text-xs uppercase tracking-wide text-zinc-400">
              {label}
            </div>
            <div className="mt-1 font-semibold tabular-nums">
              {connected
                ? `#${blocks?.toLocaleString() ?? "?"} · ${chain}`
                : status.isConnecting
                  ? "Connecting…"
                  : "Offline"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function BinaryChain() {
  const coin = useActiveCoin();
  const profile = getCoinProfile(coin);
  const networkMode = useNetworkMode();
  const { data: daemon, isConnecting } = useDaemonStatus(coin);
  const mode = networkMode.data?.mode ?? "mainnet";
  const rpcReady =
    daemon?.connected === true && !daemon?.warming_up && !isConnecting;

  const status = useQuery({
    queryKey: ["binarychain_status", mode, coin],
    queryFn: () => rpcBinaryChainStatus(coin),
    enabled: rpcReady,
    refetchInterval: REFRESH_MS,
    retry: daceQueryRetry,
    retryDelay: (attempt) => (attempt < 5 ? 2_000 : 5_000),
  });

  const metrics = useQuery({
    queryKey: ["binarychain_metrics", mode, coin],
    queryFn: () => rpcBinaryChainMetrics(coin),
    enabled: rpcReady && status.isSuccess,
    refetchInterval: REFRESH_MS,
    retry: daceQueryRetry,
  });

  const anchor = useQuery({
    queryKey: ["binarychain_anchor", mode, coin],
    queryFn: () => rpcBinaryChainAnchor(coin),
    enabled: rpcReady && status.isSuccess,
    refetchInterval: REFRESH_MS,
    retry: daceQueryRetry,
  });

  if (!networkMode.data?.is_test) {
    return (
      <div className="p-6 space-y-3">
        <h1 className="text-2xl font-bold">Binary Chain</h1>
        <p className="text-sm text-zinc-400">
          DACE status is shown on the isolated binarytest network. Switch
          network mode in Settings to use the DACE test chain.
        </p>
        <Link to="/settings" className="text-sm text-accent underline">
          Open Settings → Network
        </Link>
      </div>
    );
  }

  if (isConnecting || !daemon?.connected || daemon?.warming_up) {
    return (
      <div className="p-6 space-y-3">
        <div className="flex items-center gap-2 text-zinc-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            {isConnecting || !daemon?.connected
              ? `Connecting to ${profile.binaryName} on binarytest (RPC port ${
                  networkMode.data?.coin_endpoints
                    .find((e) => e.coin === coin)
                    ?.rpc_url.split(":")
                    .pop() ?? "…"
                })…`
              : `${profile.displayName} is loading the chain index…`}
          </span>
        </div>
        <p className="text-sm text-zinc-500">
          Binary Chain RPC becomes available once the node finishes startup. On
          a fresh binarytest datadir this can take up to a minute.
        </p>
      </div>
    );
  }

  if (status.isLoading || (status.isFetching && !status.data)) {
    return (
      <div className="p-6 flex items-center gap-2 text-zinc-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Binary Chain status…
      </div>
    );
  }

  if (status.error) {
    if (isRpcWarmupError(status.error)) {
      return (
        <div className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-zinc-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            {profile.displayName} is still starting…
          </div>
          <p className="text-sm text-zinc-500">{String(status.error)}</p>
        </div>
      );
    }

    if (isDaceRpcMissing(status.error)) {
      return (
        <div className="p-6 space-y-4 max-w-2xl">
          <h1 className="text-xl font-semibold text-amber-200">
            DACE-enabled {profile.binaryName} required
          </h1>
          <p className="text-sm text-zinc-300">
            The wallet connected to {profile.binaryName}, but this binary does
            not expose <code className="text-xs">binarychain_status</code>. The
            sidecar downloaded from production releases does not include DACE
            yet — you need a build from the unified{" "}
            <code className="text-xs">vericoin/</code> tree.
          </p>
          <ol className="list-decimal list-inside text-sm text-zinc-400 space-y-2">
            <li>
              Build:{" "}
              <code className="text-xs">
                cd vericoin && ./configure --enable-verium --without-gui && make
              </code>
            </li>
            <li>
              Point the wallet at it: set{" "}
              <code className="text-xs">VERIUMD_LOCAL</code> /{" "}
              <code className="text-xs">VERICOIND_LOCAL</code> and run{" "}
              <code className="text-xs">npm run fetch:veriumd</code>, or set the
              path in Settings → Daemon connection.
            </li>
            <li>Restart the wallet and start the binarytest daemon again.</li>
          </ol>
          <p className="text-xs text-zinc-500">
            Specs: vericoin/doc/dace/ · Harness:
            vericoin/test/binarychain/README.md
          </p>
        </div>
      );
    }

    return (
      <div className="p-6 space-y-2 text-red-400 max-w-2xl">
        <div className="font-medium">Binary Chain status unavailable</div>
        <p className="text-sm text-zinc-400">{String(status.error)}</p>
        <Link to="/settings#daemon-connection" className="text-sm underline">
          Check daemon connection →
        </Link>
      </div>
    );
  }

  if (!status.data) {
    return (
      <div className="p-6 text-zinc-400">
        No Binary Chain status returned from the daemon.
      </div>
    );
  }

  const s = status.data;
  const m = metrics.data;
  const a = anchor.data;

  return (
    <div className="p-6 space-y-6">
      <header>
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold">Binary Chain</h1>
          <span className="rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 px-2 py-0.5 text-xs font-semibold uppercase">
            Binarytest
          </span>
        </div>
        <p className="text-sm text-zinc-400">
          DACE — Dual-Anchor Coupled Epochs.{" "}
          {s.activated
            ? "Rules active on this chain."
            : "Pre-activation (below DACE height)."}{" "}
          Play-money test network only.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Status below is read from{" "}
          <span className="font-semibold text-zinc-300">
            {profile.displayName} ({profile.binaryName})
          </span>
          . Switch the sidebar coin to query the other daemon; both chains must
          advance for DACE coupling.
        </p>
        {!s.activated && (
          <p className="mt-2 text-xs text-zinc-500">
            Binarytest activates DACE at block 50 on both chains. Mine/stake
            forward or use the test harness scripts to advance height.
          </p>
        )}
      </header>

      <section>
        <h2 className="text-lg font-semibold mb-3">Chain heights</h2>
        <BinaryChainHeights />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          Status · {profile.symbol}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Stat label="Activated" value={s.activated ? "Yes" : "No"} />
          <Stat label="Current epoch" value={s.current_epoch.toString()} />
          <Stat
            label="Stale-coupled"
            value={s.stale_coupled ? "Yes" : "No"}
            hint={s.stale_reason}
          />
          <Stat
            label="Bonded tickets active"
            value={s.bonded_tickets_active.toString()}
          />
          <Stat
            label="Total bonded"
            value={`${s.bonded_tickets_total_amount.toFixed(2)} ${coin === "vericoin" ? "VRC" : "VRM"}`}
          />
          <Stat
            label="Paired header lag p95"
            value={`${s.paired_header_lag_p95_sec.toFixed(1)}s`}
            hint={`p99 ${s.paired_header_lag_p99_sec.toFixed(1)}s`}
          />
        </div>
      </section>

      {a && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Active anchor</h2>
          <div className="border border-zinc-700 rounded-md p-4 bg-zinc-900/30 text-sm space-y-1">
            <div>
              <span className="text-zinc-400">epoch:</span> {a.epoch}
            </div>
            <div className="truncate">
              <span className="text-zinc-400">beacon_ref:</span> {a.beacon_ref}
            </div>
            <div className="truncate">
              <span className="text-zinc-400">vrc_checkpoint:</span>{" "}
              {a.vrc_checkpoint_hash} @ {a.vrc_checkpoint_height}
            </div>
            <div className="truncate">
              <span className="text-zinc-400">committee_root:</span>{" "}
              {a.committee_root}
            </div>
            <div className="truncate">
              <span className="text-zinc-400">reward_root_vrc_prev:</span>{" "}
              {a.reward_root_vrc_prev}
            </div>
            <div className="truncate">
              <span className="text-zinc-400">reward_root_vrm_prev:</span>{" "}
              {a.reward_root_vrm_prev}
            </div>
          </div>
        </section>
      )}

      {m && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Threat-model metrics</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat
              label="Divergent beacons"
              value={m.divergent_beacon_selections.toString()}
            />
            <Stat
              label="Reorgs at beacon"
              value={m.reorgs_at_beacon.toString()}
            />
            <Stat
              label="Missed votes"
              value={m.committee_missed_votes.toString()}
            />
            <Stat
              label="Foreign payee rejects"
              value={m.foreign_payee_rejections.toString()}
            />
            <Stat
              label="Consecutive missed anchors"
              value={m.consecutive_missed_anchors.toString()}
            />
            <Stat
              label="IBD replay diffs"
              value={m.ibd_replay_consensus_diffs.toString()}
            />
            <Stat
              label="Recovery anchors built"
              value={m.recovery_anchors_built.toString()}
            />
            <Stat
              label="Top-10 ticket share"
              value={(m.top10_ticket_share * 100).toFixed(1) + "%"}
              hint={`seat/bonded ratio ${m.seat_to_bonded_ratio_top10.toFixed(2)}`}
            />
          </div>
        </section>
      )}

      <BinaryChainActions coin={coin} mode={mode} />
    </div>
  );
}

function BinaryChainActions({
  coin,
  mode,
}: {
  coin: "verium" | "vericoin";
  mode: string;
}) {
  const qc = useQueryClient();
  const [fundBlocks, setFundBlocks] = useState(10);
  const [stakeOutpoint, setStakeOutpoint] = useState("");
  const [operatorPubkey, setOperatorPubkey] = useState("");
  const [leafHash, setLeafHash] = useState("");
  const [fundResult, setFundResult] = useState<BinaryChainFundResult | null>(
    null,
  );

  const fund = useMutation({
    mutationFn: () => rpcBinaryChainFundWallet(coin, fundBlocks),
    onSuccess: (r) => {
      setFundResult(r);
      qc.invalidateQueries({ queryKey: coinQueryKey(coin, "getwalletinfo") });
      qc.invalidateQueries({
        queryKey: coinQueryKey(coin, "getblockchaininfo"),
      });
      qc.invalidateQueries({
        queryKey: coinQueryKey("vericoin", "daemon-status"),
      });
      qc.invalidateQueries({
        queryKey: coinQueryKey("verium", "daemon-status"),
      });
      qc.invalidateQueries({ queryKey: ["binarychain_status", mode, coin] });
      qc.invalidateQueries({ queryKey: ["binarychain_metrics", mode, coin] });
      qc.invalidateQueries({ queryKey: ["binarychain_anchor", mode, coin] });
    },
  });

  const register = useMutation({
    mutationFn: () =>
      rpcBinaryChainRegisterTicket(coin, stakeOutpoint, operatorPubkey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["binarychain_status", mode, coin] });
      qc.invalidateQueries({ queryKey: ["binarychain_metrics", mode, coin] });
    },
  });

  const redeem = useMutation({
    mutationFn: () => rpcBinaryChainRedeemClaim(coin, leafHash),
  });

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Actions</h2>

      <div className="border border-zinc-700 rounded-md p-4 bg-zinc-900/30 space-y-2">
        <div className="text-sm font-medium text-zinc-200">
          Fund test wallet
        </div>
        <p className="text-xs text-zinc-400">
          Mine PoW blocks to a new wallet address so you have spendable{" "}
          {coin === "vericoin" ? "VRC" : "VRM"} for sends, staking, or ticket
          registration. Binarytest only.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-zinc-400">Blocks:</label>
          <input
            type="number"
            min={1}
            max={500}
            value={fundBlocks}
            onChange={(e) => setFundBlocks(parseInt(e.target.value, 10) || 10)}
            className="w-20 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={fund.isPending}
            onClick={() => fund.mutate()}
            className="rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-zinc-900 text-sm font-semibold px-3 py-1.5"
          >
            {fund.isPending ? "Mining…" : "Fund"}
          </button>
        </div>
        {fund.error && (
          <p className="text-xs text-red-400">{String(fund.error)}</p>
        )}
        {fundResult && (
          <p className="text-xs text-zinc-300">
            Mined {fundResult.blocks.length} blocks to{" "}
            <span className="font-mono">{fundResult.address}</span>
          </p>
        )}
      </div>

      <div className="border border-zinc-700 rounded-md p-4 bg-zinc-900/30 space-y-2">
        <div className="text-sm font-medium text-zinc-200">
          Register bonded ticket
        </div>
        <p className="text-xs text-zinc-400">
          VRC-side committee membership. Provide a stake outpoint (txid:vout)
          holding TicketStakeUnit and the operator pubkey that will sign Joint
          Anchors.
        </p>
        <input
          type="text"
          placeholder="stake outpoint (txid:vout)"
          value={stakeOutpoint}
          onChange={(e) => setStakeOutpoint(e.target.value)}
          className="block w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs font-mono"
        />
        <input
          type="text"
          placeholder="operator pubkey (33-byte compressed hex)"
          value={operatorPubkey}
          onChange={(e) => setOperatorPubkey(e.target.value)}
          className="block w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs font-mono"
        />
        <button
          type="button"
          disabled={register.isPending || !stakeOutpoint || !operatorPubkey}
          onClick={() => register.mutate()}
          className="rounded bg-zinc-200 hover:bg-white disabled:opacity-50 text-zinc-900 text-sm font-semibold px-3 py-1.5"
        >
          {register.isPending ? "Registering…" : "Register ticket"}
        </button>
        {register.error && (
          <p className="text-xs text-red-400">{String(register.error)}</p>
        )}
        {register.data && (
          <p className="text-xs text-emerald-300">
            Registered. Active from epoch{" "}
            {String((register.data as any).active_from_epoch)}.
          </p>
        )}
      </div>

      <div className="border border-zinc-700 rounded-md p-4 bg-zinc-900/30 space-y-2">
        <div className="text-sm font-medium text-zinc-200">
          Redeem reward claim
        </div>
        <p className="text-xs text-zinc-400">
          Spend a DACE cross-chain reward leaf into the local chain. The leaf
          hash comes from an activated Joint Anchor's reward accumulator.
        </p>
        <input
          type="text"
          placeholder="leaf hash (32-byte hex)"
          value={leafHash}
          onChange={(e) => setLeafHash(e.target.value)}
          className="block w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs font-mono"
        />
        <button
          type="button"
          disabled={redeem.isPending || !leafHash}
          onClick={() => redeem.mutate()}
          className="rounded bg-zinc-200 hover:bg-white disabled:opacity-50 text-zinc-900 text-sm font-semibold px-3 py-1.5"
        >
          {redeem.isPending ? "Redeeming…" : "Redeem"}
        </button>
        {redeem.error && (
          <p className="text-xs text-red-400">{String(redeem.error)}</p>
        )}
        {redeem.data && (
          <p className="text-xs text-emerald-300">
            {String((redeem.data as any).status ?? "ok")}
          </p>
        )}
      </div>
    </section>
  );
}
