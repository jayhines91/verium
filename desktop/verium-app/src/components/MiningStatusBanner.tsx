import type { ReactNode } from "react";
import { formatVrm } from "@/lib/utils";

export interface MiningStatusBannerProps {
  syncStalled?: boolean;
  chainSynced?: boolean;
  ibd?: boolean;
  localBlocks?: number;
  syncTarget?: number;
  blocksBehind?: number;
  immatureBalance?: number;
}

export function MiningStatusBanner({
  syncStalled,
  chainSynced = true,
  ibd,
  localBlocks,
  syncTarget,
  blocksBehind,
  immatureBalance = 0,
}: MiningStatusBannerProps) {
  const items: {
    key: string;
    tone: "danger" | "warning" | "accent";
    body: ReactNode;
  }[] = [];

  if (syncStalled) {
    items.push({
      key: "stalled",
      tone: "danger",
      body: "Sync is stalled — rebuild WSL veriumd from the banner at the top.",
    });
  } else if (!chainSynced) {
    items.push({
      key: "sync",
      tone: "warning",
      body: (
        <>
          {ibd
            ? "Mining is disabled while the node is syncing"
            : "Mining is disabled until the node reaches the network tip"}{" "}
          ({localBlocks?.toLocaleString() ?? "…"}
          {syncTarget != null &&
            syncTarget > (localBlocks ?? 0) && (
              <> / ~{syncTarget.toLocaleString()} network tip</>
            )}
          {blocksBehind != null && blocksBehind > 0 && (
            <> · ~{blocksBehind.toLocaleString()} blocks behind</>
          )}
          ).
        </>
      ),
    });
  }

  if (immatureBalance > 0) {
    items.push({
      key: "immature",
      tone: "accent",
      body: (
        <>
          Pending from recent blocks:{" "}
          <strong>{formatVrm(immatureBalance, 4)}</strong> (immature)
        </>
      ),
    });
  }

  if (items.length === 0) return null;

  const toneClass = {
    danger: "border-danger/30 bg-danger/10 text-danger",
    warning: "border-warning/30 bg-warning/10 text-warning",
    accent: "border-accent/30 bg-accent/10 text-fg",
  };

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.key}
          className={`rounded-lg border px-4 py-3 text-sm ${toneClass[item.tone]}`}
        >
          {item.body}
        </div>
      ))}
    </div>
  );
}
