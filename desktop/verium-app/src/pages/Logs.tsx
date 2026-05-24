import { useEffect, useRef, useState } from "react";
import { Pause, Play, RefreshCcw, Square } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useActiveCoin } from "@/lib/coin/context";
import { getCoinProfile } from "@/lib/coin/profile";
import { tauriTailLogs } from "@/lib/rpc/client";

const POLL_MS = 2_000;

export function Logs() {
  const coin = useActiveCoin();
  const profile = getCoinProfile(coin);
  const [lines, setLines] = useState<string[]>([]);
  const [liveMode, setLiveMode] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!liveMode) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (paused || stopped) return;
      try {
        const next = await tauriTailLogs(coin, 400);
        if (!stopped) {
          setLines(next);
          setError(null);
        }
      } catch (e) {
        if (!stopped) setError(String(e));
      } finally {
        if (!stopped && !paused) {
          timer = setTimeout(poll, POLL_MS);
        }
      }
    };

    void poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [coin, liveMode, paused]);

  useEffect(() => {
    if (!liveMode || paused) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [lines, liveMode, paused]);

  const refreshOnce = async () => {
    try {
      setLines(await tauriTailLogs(coin, 400));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Node logs</CardTitle>
          <CardDescription>
            Tail of {profile.binaryName} debug.log from your data directory.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {liveMode ? (
            <Badge tone="success">Live</Badge>
          ) : (
            <Badge tone="neutral">Paused</Badge>
          )}
          <Button size="sm" variant="secondary" onClick={() => void refreshOnce()}>
            <RefreshCcw className="h-3.5 w-3.5" /> Refresh
          </Button>
          {!liveMode ? (
            <Button size="sm" onClick={() => setLiveMode(true)}>
              <Play className="h-3.5 w-3.5" /> Start live
            </Button>
          ) : paused ? (
            <Button size="sm" onClick={() => setPaused(false)}>
              <Play className="h-3.5 w-3.5" /> Resume
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setPaused(true)}>
              <Pause className="h-3.5 w-3.5" /> Pause
            </Button>
          )}
          {liveMode && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setLiveMode(false);
                setPaused(false);
              }}
            >
              <Square className="h-3.5 w-3.5" /> Stop
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}
        <div
          ref={scrollRef}
          className="max-h-[32rem] overflow-auto rounded-md border border-border bg-bg-subtle p-3 font-mono text-[11px] leading-relaxed text-fg-muted"
        >
          {lines.length === 0 ? (
            <div className="text-fg-subtle">
              No log lines yet. Start live tail or refresh.
            </div>
          ) : (
            lines.map((line, i) => (
              <div key={`${i}-${line.slice(0, 24)}`} className="whitespace-pre-wrap">
                {line}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
