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
import {
  fetchExplorerPeers,
  isExplorerApiEnabled,
} from "@/lib/explorer-api";
import { EXPLORER_PEERS } from "@/lib/verium-links";
import {
  rpcAddNode,
  rpcGetAddedNodeInfo,
  rpcGetPeerInfo,
} from "@/lib/rpc/client";

export function ExplorerPeersPanel() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const explorerEnabled = useQuery({
    queryKey: ["explorer-api-enabled"],
    queryFn: isExplorerApiEnabled,
    staleTime: Infinity,
  });

  const explorerPeers = useQuery({
    queryKey: ["explorer-peers"],
    queryFn: fetchExplorerPeers,
    enabled: explorerEnabled.data === true,
    refetchInterval: 300_000,
    retry: 0,
  });

  const localPeers = useQuery({
    queryKey: ["getpeerinfo"],
    queryFn: rpcGetPeerInfo,
    refetchInterval: 5_000,
  });

  const addedNodes = useQuery({
    queryKey: ["getaddednodeinfo"],
    queryFn: rpcGetAddedNodeInfo,
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

  const addNode = useMutation({
    mutationFn: ({ node, command }: { node: string; command: "add" | "onetry" }) =>
      rpcAddNode(node, command),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["getpeerinfo"] });
      void queryClient.invalidateQueries({ queryKey: ["getaddednodeinfo"] });
      void queryClient.invalidateQueries({ queryKey: ["getnetworkinfo"] });
    },
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = explorerPeers.data ?? [];
    if (!q) return list;
    return list.filter(
      (p) =>
        p.address.toLowerCase().includes(q) ||
        p.subversion.toLowerCase().includes(q),
    );
  }, [explorerPeers.data, filter]);

  if (explorerEnabled.data !== true) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Known network peers</CardTitle>
          <CardDescription>
            Peers seen by the official explorer in the last 24 hours. Add nodes
            to your local <span className="font-mono">veriumd</span> with one
            click — same list as{" "}
            <ExplorerLink target={{ kind: "raw", url: EXPLORER_PEERS }} label="Peers on explorer" />.
          </CardDescription>
        </div>
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

        {!explorerPeers.isError && (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-bg-panel text-xs uppercase text-fg-subtle">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Address</th>
                  <th className="px-4 py-2 text-left font-medium">Subver</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const connected = connectedAddrs.has(p.address.toLowerCase());
                  const added = addedSet.has(p.address.toLowerCase());
                  const pending =
                    addNode.isPending && addNode.variables?.node === p.address;
                  return (
                    <tr
                      key={p.address}
                      className="border-t border-border odd:bg-bg-subtle/30"
                    >
                      <td className="px-4 py-2 font-mono text-xs">
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
                      <td className="truncate px-4 py-2 text-xs text-fg-muted">
                        {p.subversion}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {connected && (
                            <Badge tone="success">Connected</Badge>
                          )}
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
                            disabled={pending || connected}
                            onClick={() =>
                              addNode.mutate({ node: p.address, command: "onetry" })
                            }
                          >
                            Try once
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={pending || added}
                            onClick={() =>
                              addNode.mutate({ node: p.address, command: "add" })
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
                      colSpan={4}
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

        {addNode.error && (
          <div className="px-4 pb-3 text-xs text-danger">
            {String(addNode.error)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
