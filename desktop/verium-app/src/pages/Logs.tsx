import { useEffect, useRef, useState } from "react";
import { Pause, Play, Radio, RefreshCcw, Square } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { tauriTailLogs } from "@/lib/rpc/client";

const POLL_MS = 2_000;

export function Logs() {
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
        const next = await tauriTailLogs(400);
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
  }, [liveMode, paused]);

  useEffect(() => {
    if (scrollRef.current && liveMode && !paused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, liveMode, paused]);

  const startLiveMode = () => {
    setPaused(false);
    setLiveMode(true);
  };

  const stopLiveMode = () => {
    setLiveMode(false);
    setPaused(false);
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>debug.log</CardTitle>
            <Badge tone={liveMode ? (paused ? "warning" : "accent") : "neutral"}>
              {liveMode ? (paused ? "Paused" : "Live") : "Idle"}
            </Badge>
          </div>
          <CardDescription>
            {liveMode
              ? "Streaming the daemon log from your data directory."
              : "Idle — start Live Mode to stream debug.log."}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {!liveMode ? (
            <Button size="sm" onClick={startLiveMode}>
              <Radio className="h-3.5 w-3.5" /> Live Mode
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? (
                  <>
                    <Play className="h-3.5 w-3.5" /> Resume
                  </>
                ) : (
                  <>
                    <Pause className="h-3.5 w-3.5" /> Pause
                  </>
                )}
              </Button>
              <Button size="sm" variant="ghost" onClick={stopLiveMode}>
                <Square className="h-3.5 w-3.5" /> Stop live
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLines([])}
            title="Clear local buffer"
          >
            <RefreshCcw className="h-3.5 w-3.5" /> Clear
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && <div className="mb-2 text-xs text-danger">{error}</div>}
        <div
          ref={scrollRef}
          className="h-[520px] overflow-auto rounded-md border border-border bg-black/40 p-3 font-mono text-xs leading-5 text-fg-muted"
        >
          {!liveMode && lines.length === 0 ? (
            <div className="text-fg-subtle">
              Log streaming is off. Click <strong>Live Mode</strong> to tail
              debug.log.
            </div>
          ) : lines.length === 0 ? (
            <div className="text-fg-subtle">Waiting for log output…</div>
          ) : (
            lines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {line}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
