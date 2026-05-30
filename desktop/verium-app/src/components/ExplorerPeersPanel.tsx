import { useActiveCoin } from "@/lib/coin/context";
import { coinQueryKey, getCoinProfile } from "@/lib/coin/profile";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { ExplorerLink } from "@/components/ExplorerLink";
import { fetchExplorerPeers, isExplorerApiEnabled } from "@/lib/explorer-api";
import type { ExplorerPeerEntry } from "@/lib/explorer-api";
import { explorerPeersHash } from "@/lib/explorer-links";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import {
  rpcAddNode,
  rpcGetAddedNodeInfo,
  rpcGetPeerInfo,
} from "@/lib/rpc/client";
import { formatNumber, formatRelativeTime } from "@/lib/utils";

function formatLastSeen(raw?: string): string {
  if (!raw?.trim()) return "—";
  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) {
    return formatRelativeTime(ms / 1000);
  }
  return raw;
}

function peerEligibleToAdd(
  p: ExplorerPeerEntry,
  connectedAddrs: Set<string>,
  addedSet: Set<string>,
): boolean {
  const key = p.address.toLowerCase();
  return !connectedAddrs.has(key) && !addedSet.has(key);
}

export function ExplorerPeersPanel() {
  const coin = useActiveCoin();
  const profile = getCoinProfile(coin);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const { data: daemonStatus } = useDaemonStatus(coin);
  const daemonConnected = daemonStatus?.connected === true;
  const explorerEnabled = useQuery({
    queryKey: ["explorer-api-enabled"],
    queryFn: isExplorerApiEnabled,
    staleTime: Infinity,
  });

  const explorerPeers = useQuery({
    queryKey: coinQueryKey(coin, "explorer-peers"),
    queryFn: () => fetchExplorerPeers(coin),
    enabled: explorerEnabled.data === true,
    refetchInterval: 300_000,
    retry: 0,
  });

  const localPeers = useQuery({
    queryKey: coinQueryKey(coin, "getpeerinfo"),
    queryFn: () => rpcGetPeerInfo(coin),
    refetchInterval: 5_000,
  });

  const addedNodes = useQuery({
    queryKey: coinQueryKey(coin, "getaddednodeinfo"),
    queryFn: () => rpcGetAddedNodeInfo(coin),
    refetchInterval: 10_000,
  });

  const connectedAddrs = useMemo(() => {
    const set = new Set<string>();
    for (const p of localPeers.data ?? []) {
      set.add(p.addr.toLowerCase());
    }
    return set;
  }, [localPeers.data]);

  const addedSet = useMemo(() => {
    return new Set(
      (addedNodes.data ?? []).map((n) => n.addednode.toLowerCase()),
    );
  }, [addedNodes.data]);

  const invalidatePeerQueries = () => {
    void queryClient.invalidateQueries({
      queryKey: coinQueryKey(coin, "getpeerinfo"),
    });
    void queryClient.invalidateQueries({
      queryKey: coinQueryKey(coin, "getaddednodeinfo"),
    });
    void queryClient.invalidateQueries({
      queryKey: coinQueryKey(coin, "getnetworkinfo"),
    });
  };

  const addNode = useMutation({
    mutationFn: ({
      node,
      command,
    }: {
      node: string;
      command: "add" | "onetry";
    }) => rpcAddNode(coin, node, command),
    onSuccess: invalidatePeerQueries,
  });

  const addAllNodes = useMutation({
    mutationFn: async (nodes: string[]) => {
      const failures: string[] = [];
      for (const node of nodes) {
        try {
          await rpcAddNode(coin, node, "add");
        } catch {
          failures.push(node);
        }
      }
      if (failures.length > 0) {
        throw new Error(
          `Could not add ${failures.length} of ${nodes.length} peer(s). First failure: ${failures[0]}`,
        );
      }
    },
    onSuccess: invalidatePeerQueries,
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = explorerPeers.data ?? [];
    if (!q) return list;
    return list.filter(
      (p) =>
        p.address.toLowerCase().includes(q) ||
        p.subversion.toLowerCase().includes(q) ||
        String(p.protocol_version).includes(q) ||
        (p.last_seen?.toLowerCase().includes(q) ?? false),
    );
  }, [explorerPeers.data, filter]);

  const addAllTargets = useMemo(
    () =>
      filtered.filter((p) =>
        peerEligibleToAdd(p, connectedAddrs, addedSet),
      ),
    [filtered, connectedAddrs, addedSet],
  );

  if (explorerEnabled.data !== true) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <CardTitle>Known network peers</CardTitle>
          <CardDescription>
            Peers seen by the official explorer in the last 24 hours.{" "}
            <span className="font-medium text-fg-muted">Try once</span> and{" "}
            <span className="font-medium text-fg-muted">Add</span> call your
            local <span className="font-mono">{profile.binaryName}</span>{" "}
            <span className="font-mono">addnode</span> RPC (runtime only — not
            written to <span className="font-mono">{profile.confFilename}</span>
            ). Use the copy icon for a conf line. Same list as{" "}
            <ExplorerLink
              coin={coin}
              target={{ kind: "raw", url: explorerPeersHash(coin) }}
              label="Peers on explorer"
            />
            .
          </CardDescription>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={
              !daemonConnected ||
              addAllTargets.length === 0 ||
              addAllNodes.isPending
            }
            title={
              !daemonConnected
                ? `Connect ${profile.displayName} first`
                : `Add ${addAllTargets.length} peer(s) via addnode RPC`
            }
            onClick={() =>
              addAllNodes.mutate(addAllTargets.map((p) => p.address))
            }
          >
            {addAllNodes.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            Add all ({addAllTargets.length})
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => explorerPeers.refetch()}
            disabled={explorerPeers.isFetching}
          >
            {explorerPeers.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-0">
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
          <input
            type="search"
            placeholder="Filter by address or version…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 min-w-[200px] flex-1 rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
          />
          <span className="text-xs text-fg-subtle">
            {filtered.length} peer{filtered.length === 1 ? "" : "s"}
            {localPeers.data
              ? ` · ${localPeers.data.length} connected locally`
              : ""}
          </span>
        </div>

        {explorerPeers.isError && (
          <div className="px-4 pb-4 text-xs text-fg-subtle">
            Could not load explorer peer directory.
          </div>
        )}

        {!daemonConnected && (
          <div className="px-4 pb-2 text-xs text-fg-muted">
            Start or connect {profile.displayName} to use Try once, Add, or Add
            all.
          </div>
        )}

        {!explorerPeers.isError && (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-bg-panel text-xs uppercase text-fg-subtle">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Address</th>
                  <th className="px-4 py-2 text-left font-medium">Subver</th>
                  <th className="px-4 py-2 text-left font-medium">Proto</th>
                  <th className="px-4 py-2 text-left font-medium">Last seen</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const connected = connectedAddrs.has(p.address.toLowerCase());
                  const added = addedSet.has(p.address.toLowerCase());
                  const pending =
                    (addNode.isPending && addNode.variables?.node === p.address) ||
                    (addAllNodes.isPending &&
                      addAllTargets.some((t) => t.address === p.address));
                  const canAdd = peerEligibleToAdd(p, connectedAddrs, addedSet);
                  return (
                    <tr
                      key={p.address}
                      className="border-t border-border odd:bg-bg-subtle/30"
                    >
                      <td className="px-4 py-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span>{p.address}</span>
                          <button
                            type="button"
                            aria-label="Copy addnode line"
                            title="Copy addnode= line"
                            className="text-fg-muted hover:text-fg"
                            onClick={() =>
                              void navigator.clipboard.writeText(
                                `addnode=${p.address}`,
                              )
                            }
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="max-w-[140px] truncate px-4 py-2 text-xs text-fg-muted">
                        {p.subversion || "—"}
                      </td>
                      <td className="px-4 py-2 text-xs tabular-nums text-fg-muted">
                        {p.protocol_version > 0
                          ? formatNumber(p.protocol_version, 0)
                          : "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-fg-muted">
                        {formatLastSeen(p.last_seen)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {connected && <Badge tone="success">Connected</Badge>}
                          {added && !connected && (
                            <Badge tone="accent">Added</Badge>
                          )}
                          {p.connected_on_explorer && !connected && (
                            <Badge tone="neutral">Live on network</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={
                              !daemonConnected || pending || connected
                            }
                            title="addnode … onetry — attempt one outbound connection, then drop from the fixed-node list"
                            onClick={() =>
                              addNode.mutate({
                                node: p.address,
                                command: "onetry",
                              })
                            }
                          >
                            Try once
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={
                              !daemonConnected || pending || !canAdd
                            }
                            title="addnode … add — keep retrying this peer while the daemon runs"
                            onClick={() =>
                              addNode.mutate({
                                node: p.address,
                                command: "add",
                              })
                            }
                          >
                            Add
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && !explorerPeers.isLoading && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-center text-sm text-fg-subtle"
                    >
                      No peers match your filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {(addNode.error || addAllNodes.error) && (
          <div className="px-4 pb-3 text-xs text-danger">
            {String(addNode.error ?? addAllNodes.error)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
