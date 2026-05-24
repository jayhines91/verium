import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Terminal as TerminalIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { rpcRaw } from "@/lib/rpc/client";
import { useActiveCoin } from "@/lib/coin/context";
import { cn } from "@/lib/utils";

interface ConsoleEntry {
  id: string;
  command: string;
  result?: unknown;
  error?: string;
}

const HISTORY_KEY = "verium-rpc-console-history";
const MAX_HISTORY = 100;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function saveHistory(history: string[]) {
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(history.slice(-MAX_HISTORY)),
    );
  } catch {
    /* ignore */
  }
}

export function RpcConsole() {
  const coin = useActiveCoin();
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const run = useMutation({
    mutationFn: async (line: string): Promise<{ command: string; result: unknown }> => {
      const [method, ...rest] = line.trim().split(/\s+/);
      if (!method) throw new Error("empty command");
      const params = rest.map(parseArg);
      const result = await rpcRaw(coin, method, params);
      return { command: line, result };
    },
    onSuccess: ({ command, result }) => {
      setEntries((prev) => [
        ...prev,
        { id: crypto.randomUUID(), command, result },
      ]);
      const nextHistory = [...history.filter((h) => h !== command), command];
      setHistory(nextHistory);
      saveHistory(nextHistory);
      setDraft("");
      setHistoryIdx(null);
    },
    onError: (err) => {
      setEntries((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          command: draft,
          error: String(err),
        },
      ]);
    },
  });

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries]);

  const handleSubmit = () => {
    if (!draft.trim()) return;
    run.mutate(draft);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
      return;
    }
    if (e.key === "ArrowUp" && history.length > 0) {
      e.preventDefault();
      const next = historyIdx === null ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(next);
      setDraft(history[next] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx === null) return;
      const next = historyIdx + 1;
      if (next >= history.length) {
        setHistoryIdx(null);
        setDraft("");
      } else {
        setHistoryIdx(next);
        setDraft(history[next] ?? "");
      }
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TerminalIcon className="h-4 w-4 text-accent" /> RPC console
          </CardTitle>
          <CardDescription>
            Send raw JSON-RPC commands to{" "}
            <span className="font-mono">veriumd</span>. Be careful — these are
            real commands.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div
            ref={scrollRef}
            className="max-h-[55vh] min-h-[280px] overflow-y-auto rounded-md border border-border bg-bg-subtle/60 p-3 font-mono text-xs"
          >
            {entries.length === 0 ? (
              <div className="text-fg-subtle">
                Try{" "}
                <span className="font-semibold">getblockchaininfo</span>,{" "}
                <span className="font-semibold">getpeerinfo</span>, or{" "}
                <span className="font-semibold">help</span>.
              </div>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="mb-3 last:mb-0">
                  <div className="text-accent">› {entry.command}</div>
                  {entry.error ? (
                    <pre className="mt-0.5 whitespace-pre-wrap text-danger">
                      {entry.error}
                    </pre>
                  ) : (
                    <pre className="mt-0.5 whitespace-pre-wrap text-fg">
                      {formatResult(entry.result)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKey}
              placeholder="getblockchaininfo"
              spellCheck={false}
              autoFocus
              className={cn(
                "h-10 flex-1 rounded-md border border-border bg-bg-panel px-3 font-mono text-sm outline-none focus:border-accent",
              )}
            />
            <Button onClick={handleSubmit} disabled={!draft.trim() || run.isPending}>
              {run.isPending ? "Running…" : "Run"}
            </Button>
            <Button variant="ghost" onClick={() => setEntries([])}>
              Clear
            </Button>
          </div>
          <p className="text-[11px] text-fg-subtle">
            Use ↑/↓ to walk command history. Numeric and JSON arguments are
            parsed automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function parseArg(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith("[") || raw.startsWith("{") || raw.startsWith("\"")) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through to string */
    }
  }
  return raw;
}

function formatResult(value: unknown): string {
  if (value === undefined) return "(no result)";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
